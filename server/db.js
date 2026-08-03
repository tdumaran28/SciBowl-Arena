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

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}

process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }
});

export function newId() {
  return crypto.randomBytes(12).toString('hex');
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
  return records[idx];
}

export function deleteEntity(type, id) {
  const records = db.entities[type] || [];
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  save();
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
