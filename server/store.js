// Storage dispatcher: rounds and user data/statistics (Round, UserStats,
// LeaderboardEntry) go to Supabase when configured; GameSession (ephemeral
// realtime state) — and everything else when Supabase isn't set up — uses the
// local JSON store.
import * as local from './db.js';
import * as sb from './supabase.js';

const useSupabase = (type) => sb.enabled && type in sb.TABLES;

if (!sb.enabled) {
  console.warn('[store] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — rounds and user stats will be kept in the local JSON store until Supabase is configured.');
}

export async function list(type, opts) {
  return useSupabase(type) ? sb.list(type, opts) : local.listEntities(type, opts);
}

export async function upsert(type, data, createdBy) {
  return useSupabase(type) ? sb.upsert(type, data, createdBy) : local.upsertEntity(type, data, createdBy);
}

export async function count(type, filter) {
  if (useSupabase(type)) return sb.count(type, filter);
  return local.listEntities(type, { filter }).length;
}

export async function get(type, id) {
  return useSupabase(type) ? sb.get(type, id) : local.getEntity(type, id);
}

export async function create(type, data, createdBy) {
  return useSupabase(type) ? sb.create(type, data, createdBy) : local.createEntity(type, data, createdBy);
}

export async function update(type, id, data) {
  return useSupabase(type) ? sb.update(type, id, data) : local.updateEntity(type, id, data);
}

export async function remove(type, id) {
  return useSupabase(type) ? sb.remove(type, id) : local.deleteEntity(type, id);
}

export async function removeMany(type, filter) {
  return useSupabase(type) ? sb.removeMany(type, filter) : local.deleteManyEntities(type, filter);
}

export async function statsAggregates() {
  if (sb.enabled) return sb.statsAggregates();
  const stats = local.listEntities('UserStats');
  return {
    games_played: stats.reduce((s, r) => s + (r.total_games || 0), 0),
    questions_answered: stats.reduce((s, r) => s + (r.total_questions_answered || 0), 0),
    players: new Set(stats.map(r => r.user_email).filter(Boolean)).size,
    leaderboard_entries: local.listEntities('LeaderboardEntry').length,
  };
}
