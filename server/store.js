// Storage dispatcher: rounds and user data/statistics (Round, UserStats,
// LeaderboardEntry) go to Supabase when configured; GameSession (ephemeral
// realtime state) — and everything else when Supabase isn't set up — uses the
// local JSON store.
import * as local from './db.js';
import * as sb from './supabase.js';
// Imported for its side effect: subscribing to GameSession writes so live
// rooms are mirrored to Postgres and survive a restart or an idle spin-down.
// Re-exported so the session routes can await the one-time restore.
import { ensureSessionsLoaded } from './sessionStore.js';

export { ensureSessionsLoaded };

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

/**
 * Dashboard aggregates.
 *
 * UserStats only records solo play, so counting games and answers from it alone
 * reported zero for every multiplayer match ever played. Sessions are the other
 * half and they always live in the local store (they are ephemeral realtime
 * state), so both halves are added here rather than in either backend.
 */
export async function statsAggregates() {
  const base = sb.enabled ? await sb.statsAggregates() : localUserAggregates();

  const multiplayer = local.listEntities('GameSession', { filter: { mode: 'multiplayer' } });
  // A room that plays several rounds without closing counts once — an
  // undercount, but every one of these is a game that really happened.
  const multiplayerGames = multiplayer.filter(s => s.status === 'finished').length;
  const multiplayerAnswers = multiplayer.reduce((n, s) => n + (s.question_results?.length || 0), 0);

  // Everyone who has signed in has an AppUser row (server/users.js), which is a
  // truer "players" count than "people who have finished a solo game" — but
  // take the larger of the two, so a deployment whose app_users table predates
  // this doesn't report fewer players than it has stats for.
  const registered = await count('AppUser').catch(() => 0);

  return {
    ...base,
    games_played: (base.games_played || 0) + multiplayerGames,
    questions_answered: (base.questions_answered || 0) + multiplayerAnswers,
    players: Math.max(base.players || 0, registered || 0),
  };
}

function localUserAggregates() {
  const stats = local.listEntities('UserStats');
  return {
    games_played: stats.reduce((s, r) => s + (r.total_games || 0), 0),
    questions_answered: stats.reduce((s, r) => s + (r.total_questions_answered || 0), 0),
    players: new Set(stats.map(r => r.user_email).filter(Boolean)).size,
    leaderboard_entries: local.listEntities('LeaderboardEntry').length,
  };
}
