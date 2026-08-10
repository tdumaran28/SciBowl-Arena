// Supabase storage for rounds (Round) and user data/statistics (UserStats,
// LeaderboardEntry).
// Rows use a hybrid layout: common columns (id, created_date, updated_date,
// created_by) plus a `data` jsonb column holding everything else — see
// supabase/schema.sql. The server talks to Supabase with the service-role key,
// which bypasses RLS; never expose that key to the browser.
import { createClient } from '@supabase/supabase-js';
import { newId } from './db.js';

export const TABLES = {
  Round: 'rounds',
  UserStats: 'user_stats',
  LeaderboardEntry: 'leaderboard_entries',
  HelpContent: 'help_content',
  AppUser: 'app_users',
};

const BASE_COLUMNS = ['id', 'created_date', 'updated_date', 'created_by'];

// Fields that live in their own Postgres column instead of inside `data`,
// as `entityField: column_name`. Promote a field when it is filtered, sorted
// or joined on — round visibility gates every library read, so keeping it in
// jsonb would mean no index and no way to express the filter in PostgREST.
//
// Must stay in step with supabase/schema.sql.
const PROMOTED_COLUMNS = {
  Round: { title: 'name', is_public: 'is_public', owner_email: 'owner_email' },
  AppUser: { email: 'email', full_name: 'full_name', role: 'role' },
};

// Whether the database actually has the promoted columns yet. Code and schema
// deploy separately, so a running server can meet a database that predates
// this migration; rather than failing every read and write until someone runs
// supabase/schema.sql, fall back to the old all-in-jsonb layout and say so
// loudly. Probed once, lazily.
let schemaProbe = null;
let promotedReady = true;

async function ensureSchema() {
  if (!enabled || schemaProbe) return schemaProbe;
  schemaProbe = (async () => {
    const columns = Object.values(PROMOTED_COLUMNS.Round).join(',');
    const { error } = await client.from(TABLES.Round).select(`id,${columns}`).limit(1);
    if (error && /column .* does not exist/i.test(error.message)) {
      promotedReady = false;
      console.error(
        '[supabase] The `rounds` table is missing the name/is_public/owner_email columns, ' +
        'so round visibility is not enforced at the database level. ' +
        'Run supabase/schema.sql in the Supabase SQL editor to migrate.',
      );
    }
  })().catch(() => {});
  return schemaProbe;
}

function promotedFor(type) {
  if (!promotedReady && type === 'Round') return {};
  return PROMOTED_COLUMNS[type] || {};
}

// entityField -> column, including the base columns (which map to themselves).
function columnMap(type) {
  const map = { ...promotedFor(type) };
  for (const c of BASE_COLUMNS) map[c] = c;
  return map;
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const enabled = Boolean(url && serviceKey);

const client = enabled
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

/**
 * The raw PostgREST client, for tables that are not entity types.
 *
 * `game_sessions` is the only one: a live match is not stored through the
 * entity layer (it has to stay a synchronous in-process read-modify-write, see
 * server/db.js) — it is *mirrored* to Postgres so a restart doesn't end every
 * game. server/sessionStore.js owns that table and nothing else touches it.
 */
export function rawClient() {
  return client;
}

// Row → entity record: unpack `data`, then overlay the real columns under
// their entity-field names (so a Round row's `name` column surfaces as `title`).
function toRecord(type, row) {
  if (!row) return null;
  const { data, ...cols } = row;
  const record = { ...(data || {}) };
  for (const c of BASE_COLUMNS) {
    if (c in cols) record[c] = cols[c];
  }
  for (const [field, column] of Object.entries(promotedFor(type))) {
    if (column in cols) record[field] = cols[column];
  }
  return record;
}

// Entity record → { columns, data }: promoted fields become column values,
// everything else stays in the jsonb blob.
function splitRow(type, input) {
  const data = { ...input };
  const columns = {};
  for (const c of BASE_COLUMNS) delete data[c];
  for (const [field, column] of Object.entries(promotedFor(type))) {
    if (field in data) {
      columns[column] = data[field];
      delete data[field];
    }
  }
  return { columns, data };
}

// Map a sort/filter key to a PostgREST column expression: real columns pass
// through; everything else lives at data->key (jsonb `->` keeps numeric order).
function colExpr(type, key, { text = false } = {}) {
  const column = columnMap(type)[key];
  if (column) return column;
  return text ? `data->>${key}` : `data->${key}`;
}

function applyFilter(type, query, filter) {
  for (const [k, v] of Object.entries(filter || {})) {
    // `null` means "is null" in PostgREST, not an equality match.
    if (v === null) {
      query = query.is(colExpr(type, k), null);
      continue;
    }
    query = query.eq(colExpr(type, k, { text: typeof v === 'string' }), v);
  }
  return query;
}

function throwOn(error) {
  if (error) throw Object.assign(new Error(`Supabase: ${error.message}`), { status: 502 });
}

export async function list(type, { filter = null, sort = null, limit = null, or = null } = {}) {
  await ensureSchema();
  let query = client.from(TABLES[type]).select('*');
  query = applyFilter(type, query, filter);
  // `or` is a raw PostgREST or-filter (already column-qualified by the caller
  // via orExpr) — used for "public OR mine" library reads.
  if (or) query = query.or(or);
  if (sort) {
    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;
    query = query.order(colExpr(type, key), { ascending: !desc });
  }
  if (limit) query = query.limit(Number(limit));
  const { data, error } = await query;
  throwOn(error);
  return (data || []).map(row => toRecord(type, row));
}

/** Column name for an entity field, for callers building raw PostgREST filters. */
export function columnFor(type, field) {
  return columnMap(type)[field] || `data->>${field}`;
}

/**
 * Select just the named entity fields for a set of ids, in one query.
 * For authorization checks over many rounds, where pulling `data` (and with it
 * every question) would move megabytes to answer a visibility question.
 */
export async function selectColumns(type, fields, ids) {
  await ensureSchema();
  const map = columnMap(type);
  // A field with no real column still lives in `data`; fall back to selecting
  // the whole blob in that case rather than emitting invalid PostgREST.
  const needsBlob = fields.some(f => !map[f]);
  const select = needsBlob ? '*' : [...new Set(fields.map(f => map[f]))].join(',');

  const { data, error } = await client.from(TABLES[type]).select(select).in('id', ids);
  throwOn(error);
  return (data || []).map(row => toRecord(type, row));
}

export async function get(type, id) {
  await ensureSchema();
  const { data, error } = await client.from(TABLES[type]).select('*').eq('id', id).maybeSingle();
  throwOn(error);
  return toRecord(type, data);
}

export async function create(type, input, createdBy = null) {
  await ensureSchema();
  const now = new Date().toISOString();
  const { columns, data: blob } = splitRow(type, input);
  const row = {
    id: input?.id || newId(),
    created_date: now,
    updated_date: now,
    created_by: createdBy,
    ...columns,
    data: blob,
  };
  const { data, error } = await client.from(TABLES[type]).insert(row).select().single();
  throwOn(error);
  return toRecord(type, data);
}

export async function update(type, id, input) {
  await ensureSchema();
  const existing = await get(type, id);
  if (!existing) return null;
  const { columns, data: blob } = splitRow(type, { ...existing, ...input });
  const { data, error } = await client
    .from(TABLES[type])
    .update({ ...columns, data: blob, updated_date: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  throwOn(error);
  return toRecord(type, data);
}

/** Insert or update by primary key — used to mirror Clerk users on sign-in. */
export async function upsert(type, input, createdBy = null) {
  await ensureSchema();
  const now = new Date().toISOString();
  const { columns, data: blob } = splitRow(type, input);
  const row = {
    id: input.id,
    updated_date: now,
    created_by: createdBy,
    ...columns,
    data: blob,
  };
  const { data, error } = await client
    .from(TABLES[type])
    .upsert({ created_date: now, ...row }, { onConflict: 'id', ignoreDuplicates: false })
    .select()
    .single();
  throwOn(error);
  return toRecord(type, data);
}

export async function count(type, filter = null) {
  await ensureSchema();
  let query = client.from(TABLES[type]).select('id', { count: 'exact', head: true });
  query = applyFilter(type, query, filter);
  const { count: n, error } = await query;
  throwOn(error);
  return n || 0;
}

export async function remove(type, id) {
  const { data, error } = await client.from(TABLES[type]).delete().eq('id', id).select('id');
  throwOn(error);
  return (data || []).length > 0;
}

export async function removeMany(type, filter) {
  let query = client.from(TABLES[type]).delete();
  query = applyFilter(type, query, filter || {});
  const { data, error } = await query.select('id');
  throwOn(error);
  return (data || []).length;
}

// ── File storage ─────────────────────────────────────────────────────────────
// Uploaded packet files (PDF/DOCX) — Base44 used to host these; they now live
// in a public Supabase Storage bucket, auto-created on first upload.

const UPLOADS_BUCKET = 'uploads';
let bucketEnsured = null;

export async function uploadFile(name, buffer, contentType) {
  if (!bucketEnsured) {
    // createBucket fails harmlessly if the bucket already exists
    bucketEnsured = client.storage
      .createBucket(UPLOADS_BUCKET, { public: true })
      .catch(() => null);
  }
  await bucketEnsured;
  const { error } = await client.storage.from(UPLOADS_BUCKET).upload(name, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  throwOn(error);
  const { data } = client.storage.from(UPLOADS_BUCKET).getPublicUrl(name);
  return data.publicUrl;
}

// Dashboard aggregates over the Supabase-held stats.
export async function statsAggregates() {
  const { data: stats, error } = await client.from(TABLES.UserStats).select('data');
  throwOn(error);
  const rows = (stats || []).map(r => r.data || {});
  const { count, error: cErr } = await client
    .from(TABLES.LeaderboardEntry)
    .select('id', { count: 'exact', head: true });
  throwOn(cErr);
  return {
    games_played: rows.reduce((s, r) => s + (r.total_games || 0), 0),
    questions_answered: rows.reduce((s, r) => s + (r.total_questions_answered || 0), 0),
    players: new Set(rows.map(r => r.user_email).filter(Boolean)).size,
    leaderboard_entries: count || 0,
  };
}
