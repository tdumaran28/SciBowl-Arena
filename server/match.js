// Server-side match engine.
//
// Scoring and question advancement used to be computed on whichever client
// happened to act and written back as a whole-session PATCH. Because the store
// merges at the top level, two near-simultaneous writers clobbered each
// other's arrays — a chat message landing at the same instant as a score
// update could erase it, and two players resolving a question could each write
// a `players` array built from a stale read.
//
// Applying these transitions here instead makes them read-modify-write inside
// one synchronous critical section, the same guarantee the buzz claim already
// had. It also puts `reading_started_at` on the server's clock, which is what
// every client's reading position is derived from.

import { getEntity, updateEntity } from './db.js';

export const SCORING = {
  TOSSUP_CORRECT: 4,
  TOSSUP_INTERRUPT_WRONG: -4,
  BONUS_CORRECT: 10,
};

function pointsFor({ result, type }) {
  const correct = result === 'correct';
  if (correct && type === 'BONUS') return SCORING.BONUS_CORRECT;
  if (correct) return SCORING.TOSSUP_CORRECT;
  if (result === 'interrupt_wrong') return SCORING.TOSSUP_INTERRUPT_WRONG;
  return 0;
}

/**
 * Apply an answer: score it, append to the shared results log, and compute the
 * next buzz state (question resolved / bonus awarded / reopened for the
 * remaining teams).
 */
export function applyAnswer(sessionId, { playerId, displayName, team, result, type, interrupted }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;

  const bs = session.buzz_state || {};

  // Only the player holding the buzz may resolve it. Without this, any client
  // could post an answer for a question someone else buzzed on and score it
  // against them. Deliberately narrow: it rejects answering over an active
  // buzzer, but stays out of the way when no buzz is recorded (bonuses that
  // resolve on a timeout, host-forced advancement), so a match can't wedge.
  if (bs.buzzed_player_id && bs.buzzed_player_id !== playerId) {
    return { session, patch: null, rejected: 'another player holds the buzz' };
  }
  const isCorrect = result === 'correct';
  const isNeg = result === 'interrupt_wrong';
  const isBonus = type === 'BONUS';
  const pts = pointsFor({ result, type });

  const players = (session.players || []).map(p =>
    p.user_id === playerId ? { ...p, score: (p.score || 0) + pts } : p);
  const teams = (session.teams || []).map(t =>
    (team && t.name === team) ? { ...t, score: (t.score || 0) + pts } : t);

  const question_results = [...(session.question_results || []), {
    question_index: session.current_question_index || 0,
    player: displayName,
    team: team || '',
    kind: isCorrect ? 'correct' : isNeg ? 'neg' : 'wrong',
    points: pts,
    type,
    ts: new Date().toISOString(),
  }];

  let buzz_state;
  if (isCorrect && !isBonus) {
    // Tossup correct: the answering team/player earns the bonus; question closed.
    buzz_state = {
      buzzed_player_id: null, buzzed_team: null, buzzed_display_name: null,
      result: 'correct', result_player: displayName, result_player_id: playerId,
      result_team: team || '',
      result_points: pts, result_interrupted: !!interrupted,
      bonus_for_team: team || null, bonus_for_player: displayName,
      bonus_for_player_id: playerId,
      negged_teams: [...(bs.negged_teams || [])],
      negged_players: [...(bs.negged_players || [])],
      reading_started_at: bs.reading_started_at || null,
      dead: false,
    };
  } else if (isBonus) {
    // Bonus resolved either way — nobody else gets it.
    buzz_state = {
      buzzed_player_id: null, buzzed_team: null, buzzed_display_name: null,
      result: isCorrect ? 'correct' : 'wrong',
      result_player: displayName, result_player_id: playerId,
      result_team: bs.bonus_for_team || team || '',
      result_points: pts, result_interrupted: false,
      bonus_for_team: bs.bonus_for_team || null,
      bonus_for_player: bs.bonus_for_player || null,
      bonus_for_player_id: bs.bonus_for_player_id || null,
      bonus_answered_by: playerId,
      negged_teams: [], negged_players: [],
      reading_started_at: bs.reading_started_at || null,
      dead: false,
    };
  } else {
    // Tossup missed: lock out this team/player and reopen for everyone else.
    const negged_teams = [...(bs.negged_teams || [])];
    if (team && !negged_teams.includes(team)) negged_teams.push(team);
    const negged_players = [...(bs.negged_players || [])];
    if (!negged_players.includes(playerId)) negged_players.push(playerId);
    buzz_state = {
      buzzed_player_id: null, buzzed_team: null, buzzed_display_name: null,
      result: isNeg ? 'neg' : 'wrong',
      result_player: displayName, result_player_id: playerId,
      result_team: team || '',
      result_points: pts, result_interrupted: isNeg,
      bonus_for_team: null, bonus_for_player: null, bonus_for_player_id: null,
      negged_teams, negged_players,
      reading_started_at: bs.reading_started_at || null,
      dead: false,
    };
  }

  const patch = { players, teams, buzz_state, question_results };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/** Tossup timer elapsed, or everyone has already missed it. */
export function applyDead(sessionId, { isBonus = false } = {}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};
  if (bs.result === 'correct' || bs.dead) return { session, patch: null };

  const teams = session.teams || [];
  const allAnswered = teams.length > 0
    ? teams.every(t => (bs.negged_teams || []).includes(t.name))
    : (session.players || []).length > 0 &&
      (session.players || []).every(p => (bs.negged_players || []).includes(p.user_id));

  const patch = {
    buzz_state: {
      ...bs,
      buzzed_player_id: null,
      buzzed_team: null,
      buzzed_display_name: null,
      // A timed-out bonus resolves as wrong: bonuses have no reopen semantics,
      // and without a result the match could never advance past it.
      result: (allAnswered || isBonus) ? 'wrong' : null,
      dead: true,
    },
  };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Advance to the next question. `nextIndex` is computed by the caller (the
 * client knows the filtered question list), but the timestamp is stamped here
 * so every client derives its reading position from the same clock.
 */
export function applyAdvance(sessionId, { nextIndex, keepBonusOwner = false, finished = false }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};

  if (finished) {
    const patch = { status: 'finished', buzz_state: null };
    return { session: updateEntity('GameSession', sessionId, patch), patch };
  }

  const buzz_state = keepBonusOwner
    ? {
      buzzed_player_id: null, buzzed_team: null, buzzed_display_name: null,
      result: null,
      bonus_for_team: bs.bonus_for_team || null,
      bonus_for_player: bs.bonus_for_player || null,
      bonus_for_player_id: bs.bonus_for_player_id || null,
      negged_teams: [], negged_players: [],
      reading_started_at: Date.now(),
    }
    : { reading_started_at: Date.now() };

  const patch = { current_question_index: nextIndex, buzz_state };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/** Start (or restart) the match at question 0 with a server-stamped read time. */
export function applyStart(sessionId) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const patch = {
    status: 'active',
    current_question_index: 0,
    buzz_state: { reading_started_at: Date.now() },
  };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Return the room to selection so the host can pick another round with the
 * same players. Scores reset (it is a new game) but the roster and teams stay.
 */
export function applyReturnToLobby(sessionId, { roundId = '', gameType = null, resetScores = true } = {}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const patch = {
    status: 'waiting',
    round_id: roundId,
    current_question_index: 0,
    buzz_state: null,
    question_results: [],
    players: (session.players || []).map(p => (resetScores ? { ...p, score: 0, answers: [] } : p)),
    teams: (session.teams || []).map(t => (resetScores ? { ...t, score: 0 } : t)),
  };
  if (gameType) patch.game_type = gameType;
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}
