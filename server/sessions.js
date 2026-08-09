// Game-session write authorization.
//
// Sessions are reachable by id to any signed-in user (that is how joining by
// room code works), so the generic entity PATCH used to let anyone mutate any
// room: reassign teams, edit the roster, or point a room at a packet they
// cannot see. These rules keep that surface to what a room actually needs.

import { filterVisibleIds } from './rounds.js';

// The only fields a client may write directly. Everything else about a live
// match — status, current_question_index, buzz_state, question_results — is
// owned by the server routes in server/match.js, so it is not listed here and
// a PATCH carrying it is rejected rather than silently dropped.
const MEMBER_FIELDS = new Set(['players', 'teams']);
const HOST_FIELDS = new Set([
  'locked', 'is_public', 'settings', 'round_id', 'game_type',
  'round_ids', 'round_filter', 'subject_freq', 'seed',
]);

function isMember(session, user) {
  return (session?.players || []).some(p => p.user_id === user?.email);
}

function isHost(session, user) {
  return session?.host_id === user?.email;
}

/**
 * Every round a session points at must be one the writer can actually see.
 * Without this, anyone could create a room referencing someone else's private
 * packet and then read its questions back through /api/sessions/[id]/rounds —
 * turning the room-sharing path into an arbitrary-read of private libraries.
 */
async function assertRoundsVisible(input, user, existing) {
  const before = new Set([existing?.round_id, ...(existing?.round_ids || [])].filter(Boolean));
  const referenced = [input.round_id, ...(input.round_ids || [])].filter(Boolean);
  // Only newly introduced ids need checking; ones already on the session were
  // authorized when they were added.
  const added = [...new Set(referenced.filter(id => !before.has(id)))];
  if (added.length === 0) return;

  // One batched query — a marathon room names its entire packet list.
  const visible = await filterVisibleIds(added, user);
  const denied = added.filter(id => !visible.has(id));
  if (denied.length > 0) {
    throw Object.assign(
      new Error('You cannot use a packet you do not have access to'),
      { status: 403 },
    );
  }
}

/**
 * Scores live inside `players`, which members must be able to write in order
 * to pick teams. Rather than trusting the incoming array, carry the stored
 * score and answers across for every player who was already present — so a
 * roster edit cannot double as a score edit.
 */
function preserveScores(incomingPlayers, existing) {
  const byId = new Map((existing?.players || []).map(p => [p.user_id, p]));
  return (incomingPlayers || []).map(p => {
    const prior = byId.get(p.user_id);
    if (!prior) return { ...p, score: 0, answers: [] }; // a joining player starts at zero
    return { ...p, score: prior.score || 0, answers: prior.answers || [] };
  });
}

function preserveTeamScores(incomingTeams, existing) {
  const byName = new Map((existing?.teams || []).map(t => [t.name, t]));
  return (incomingTeams || []).map(t => ({ ...t, score: byName.get(t.name)?.score || 0 }));
}

/** Validate a session create. Returns the fields to persist. */
export async function authorizeSessionCreate(input, user) {
  await assertRoundsVisible(input, user, null);
  return {
    ...input,
    // The creator is the host and the roster starts with just them, whatever
    // the request claimed.
    host_id: user.email,
    players: preserveScores(input.players, null),
    teams: preserveTeamScores(input.teams, null),
  };
}

/** Validate a session PATCH. Returns the fields to persist, or throws. */
export async function authorizeSessionUpdate(input, user, existing) {
  const fields = Object.keys(input || {});
  const host = isHost(existing, user);
  const member = isMember(existing, user);

  const forbidden = fields.filter(f => !MEMBER_FIELDS.has(f) && !HOST_FIELDS.has(f));
  if (forbidden.length > 0) {
    throw Object.assign(
      new Error(`These fields are managed by the server: ${forbidden.join(', ')}`),
      { status: 403 },
    );
  }

  const hostOnly = fields.filter(f => HOST_FIELDS.has(f));
  if (hostOnly.length > 0 && !host) {
    throw Object.assign(new Error('Only the host can change the room setup'), { status: 403 });
  }

  // A non-member may write exactly one thing: the roster, to add themselves.
  // That is what joining is — so it is checked against the result, not the
  // current state.
  if (!host && !member) {
    const joining = (input.players || []).some(p => p.user_id === user?.email);
    if (!joining) {
      throw Object.assign(new Error('You are not in this room'), { status: 403 });
    }
    if (existing?.locked) {
      throw Object.assign(new Error('The host has locked this room to new players'), { status: 403 });
    }
  }

  await assertRoundsVisible(input, user, existing);

  const out = { ...input };
  if ('players' in out) out.players = preserveScores(out.players, existing);
  if ('teams' in out) out.teams = preserveTeamScores(out.teams, existing);
  return out;
}

/** May this user read the packets a session references? */
export function canReadSessionRounds(session, user) {
  return isHost(session, user) || isMember(session, user);
}

/**
 * The roster entry acting on this request.
 *
 * Sessions are reachable by id to any signed-in user (that is how joining by
 * room code works), so every match route has to establish *who is acting* from
 * the session rather than from the request body. A body-supplied `player_id`
 * let any signed-in user post an answer as somebody else — scoring points onto
 * their row, or a neg against it — buzz in their name, chat as them, or drop
 * them from a room they were playing in. None of that is reachable through the
 * UI; all of it was reachable with a `fetch`.
 *
 * Identity is the email, the same key `players[].user_id` and `host_id` carry
 * everywhere else, so a legitimate client sees no change. The display name and
 * team come from the stored roster too: those are what every other player's
 * screen shows, so reading them from the request was the one copy that could
 * disagree.
 *
 * Returns { player } for a member, or { error } to return as-is.
 */
export function requireSessionPlayer(session, user) {
  const id = user?.email;
  const player = (session?.players || []).find(p => p.user_id === id);
  if (player) return { player };
  // The host is authoritative over the room even in the window before (or
  // after) they appear on the roster — e.g. ending a game they have left.
  if (isHost(session, user)) {
    return { player: { user_id: id, display_name: user?.full_name || 'Host', team: '' } };
  }
  return { error: 'You are not in this room' };
}
