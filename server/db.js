// JSON-file datastore. Single-process, write-behind persistence.
// Holds GameSession (and acts as the fallback for Round / UserStats /
// LeaderboardEntry when Supabase isn't configured). Identity lives in Clerk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// cwd-based (not import.meta.url) so the path is stable when Next bundles
// this module into .next/
const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const ENTITY_TYPES = ['Round', 'UserStats', 'GameSession', 'LeaderboardEntry', 'HelpContent', 'AppUser'];

function emptyDb() {
  const entities = {};
  for (const t of ENTITY_TYPES) entities[t] = [];
  return { entities };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const db = emptyDb();
    db.entities = { ...db.entities, ...(raw.entities || {}) };
    return db;
  } catch {
    return emptyDb();
  }
}

export const db = load();

// Persistence is write-behind, so it runs in a timer with no caller to reject
// to: an unguarded throw here is an uncaught exception that takes the whole
// process down ~300 ms after a request that already returned 200. A read-only
// or full filesystem is exactly the case where that happens — including any
// serverless host, where the deployment bundle is read-only, so a single game
// action would crash the instance. Degrade to in-memory instead and say so
// once; the request itself has already been served from `db`.
let warnedUnwritable = false;
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    if (!warnedUnwritable) {
      warnedUnwritable = true;
      console.error(
        `[db] cannot write ${DB_FILE} (${err.code || err.message}) — the local JSON store ` +
        'is running in memory only, so nothing here survives a restart and nothing is ' +
        'shared between instances. Configure Supabase, or run on a host with a writable ' +
        'working directory.',
      );
    }
  }
}

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 300);
}

process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    persist();
  }
});

export function newId() {
  return crypto.randomBytes(12).toString('hex');
}

// ── Change notification ─────────────────────────────────────────────────────
//
// The local store is authoritative for GameSession — a buzz claim has to be a
// synchronous read-modify-write, which is why it never went to Supabase. But
// "in this process's memory" also means "gone when the process stops", and on a
// free tier the process stops constantly: a 15-minute idle spin-down or a
// redeploy took every live room with it.
//
// So writes are announced here and server/sessionStore.js mirrors them to
// Postgres write-behind. The mirror is a copy, never the source of truth — it
// is read exactly once, at boot, to put the rooms back.

const listeners = new Set();

/** Subscribe to entity writes. Returns an unsubscribe function. */
export function onEntityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type, id, record) {
  for (const fn of listeners) {
    // A mirror that throws must not take down the write that triggered it.
    try { fn(type, id, record); } catch { /* the mirror logs its own failures */ }
  }
}

/**
 * Insert a record without announcing it — used by the mirror when it puts
 * rehydrated rooms back, so restoring state doesn't echo straight back out as
 * a fresh write for every room.
 */
export function hydrateEntity(type, record) {
  if (!record?.id) return null;
  const records = db.entities[type] || (db.entities[type] = []);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx === -1) records.push(record);
  else records[idx] = record;
  save();
  return record;
}

// ── Entity helpers (Base44-compatible semantics) ────────────────────────────

function applySort(records, sort) {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

function matches(record, filter) {
  return Object.entries(filter).every(([k, v]) => record[k] === v);
}

export function listEntities(type, { filter = null, sort = null, limit = null } = {}) {
  let records = db.entities[type] || [];
  if (filter && Object.keys(filter).length > 0) {
    records = records.filter(r => matches(r, filter));
  }
  records = applySort(records, sort);
  if (limit) records = records.slice(0, Number(limit));
  return records;
}

export function getEntity(type, id) {
  return (db.entities[type] || []).find(r => r.id === id) || null;
}

export function createEntity(type, data, createdBy = null) {
  const now = new Date().toISOString();
  const record = {
    ...data,
    id: data?.id || newId(),
    created_date: now,
    updated_date: now,
    created_by: createdBy,
  };
  db.entities[type].push(record);
  save();
  emit(type, record.id, record);
  return record;
}

/** Insert or update by id — local-store twin of the Supabase upsert. */
export function upsertEntity(type, data, createdBy = null) {
  const existing = getEntity(type, data.id);
  if (existing) return updateEntity(type, data.id, data);
  return createEntity(type, data, createdBy);
}

export function updateEntity(type, id, data) {
  const records = db.entities[type] || [];
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...data, id, updated_date: new Date().toISOString() };
  save();
  emit(type, id, records[idx]);
  return records[idx];
}

export function deleteEntity(type, id) {
  const records = db.entities[type] || [];
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  save();
  emit(type, id, null);
  return true;
}

export function deleteManyEntities(type, filter) {
  const records = db.entities[type] || [];
  const keep = records.filter(r => !matches(r, filter || {}));
  const removed = records.length - keep.length;
  db.entities[type] = keep;
  if (removed > 0) save();
  return removed;
}
