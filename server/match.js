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
  // Optional house rule (session.settings.powers): a tossup answered correctly
  // before the reading finished. Mirrors SCORING in src/utils/parseRound.js —
  // keep the two in step.
  TOSSUP_POWER: 6,
  TOSSUP_INTERRUPT_WRONG: -4,
  BONUS_CORRECT: 10,
};

// How many wrong answers kill a tossup. Multiple choice is guessable — with
// four options, two wrong answers leave the field narrow enough that a third
// team would be picking from two, so it locks a buzz earlier than short answer.
export const DEAD_AFTER_WRONG = {
  'Multiple Choice': 2,
  DEFAULT: 3,
};

export function wrongLimitFor(format) {
  return DEAD_AFTER_WRONG[format] ?? DEAD_AFTER_WRONG.DEFAULT;
}

/**
 * Is this question over for everybody?
 *
 * Not the same as "has a result": a WRONG tossup answer leaves the question
 * live for the other teams, so the result fields are populated while the buzzer
 * is still open. Anything deciding whether a new buzz may be taken has to ask
 * this rather than `!!result` — reading a neg as "closed" is what stopped the
 * other team from buzzing after one (server/buzz.js).
 *
 * A bonus is closed by any result, since nobody else was going to get it.
 */
export function questionClosed(bs) {
  return !!bs?.dead || bs?.result === 'correct' || !!bs?.bonus_answered_by;
}

/**
 * Reading is frozen for the whole room while a buzz is held. When the question
 * reopens (the buzzer was wrong, or never answered), the words have to carry on
 * from where they stopped — but every client derives its position from
 * `now - reading_started_at`, so a start time left alone means the reading
 * silently jumps forward by however long the buzzer spent typing.
 *
 * Pushing the start time forward by the frozen interval keeps that one formula
 * correct for everyone, with no separate "paused for" state to keep in step.
 */
function readingResumedAt(bs, frozenSince) {
  const start = bs?.reading_started_at || null;
  if (!start || !frozenSince) return start;
  const frozenFor = Date.now() - frozenSince;
  return frozenFor > 0 ? start + frozenFor : start;
}

/**
 * A question that ended with nobody scoring on it — the clock ran out, or the
 * room stepped over it. It is worth zero either way, but leaving it out of the
 * log made it vanish from the match: the question numbering jumped and there
 * was nothing to click to read it back.
 */
function unansweredLogEntry(questionIndex, type) {
  return {
    question_index: questionIndex,
    player: '',
    team: '',
    kind: 'dead',
    points: 0,
    type: type || 'TOSSUP',
    interrupted: false,
    submitted_answer: null,
    submitted_choice: null,
    ts: new Date().toISOString(),
  };
}

/** Has anything already been logged against this question? */
function isLogged(session, questionIndex) {
  return (session?.question_results || []).some(r => r.question_index === questionIndex);
}

/**
 * Has everyone still in the room already missed this question?
 *
 * Asked of the players who are HERE, not of the `teams` array: a team keeps its
 * row after its last player leaves, so counting rows left a question "still
 * live for Blue" when Blue had gone home. Nobody could buzz it and — now that
 * advancing is not a host power — nobody could move past it either.
 *
 * Per player rather than per team, so a free-for-all room and a room with
 * unassigned players are covered by the same rule. Mirrors `roomExhausted` in
 * src/utils/matchRules.js.
 */
function roomExhausted(session, { neggedTeams = [], neggedPlayers = [] }) {
  const players = session?.players || [];
  if (players.length === 0) return false;
  return !players.some(p => (
    p.team ? !neggedTeams.includes(p.team) : !neggedPlayers.includes(p.user_id)
  ));
}

function pointsFor({ result, type, interrupted, powers }) {
  const correct = result === 'correct';
  if (correct && type === 'BONUS') return SCORING.BONUS_CORRECT;
  if (correct) return powers && interrupted ? SCORING.TOSSUP_POWER : SCORING.TOSSUP_CORRECT;
  if (result === 'interrupt_wrong') return SCORING.TOSSUP_INTERRUPT_WRONG;
  return 0;
}

/**
 * Apply an answer: score it, append to the shared results log, and compute the
 * next buzz state (question resolved / bonus awarded / reopened for the
 * remaining teams).
 */
export function applyAnswer(sessionId, {
  playerId, displayName, team, result, type, interrupted,
  submittedAnswer = null, submittedChoice = null, questionFormat = '',
}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;

  const bs = session.buzz_state || {};
  const isBonus = type === 'BONUS';

  // Only the player holding the buzz may resolve it. Without this, any client
  // could post an answer for a question someone else buzzed on and score it
  // against them. Deliberately narrow: it rejects answering over an active
  // buzzer, but stays out of the way when no buzz is recorded (bonuses, which
  // are never buzzed; host-forced advancement), so a match can't wedge.
  if (bs.buzzed_player_id && bs.buzzed_player_id !== playerId) {
    return { session, patch: null, rejected: 'another player holds the buzz' };
  }

  // The question is already over. This is what makes a bonus first-answer-wins:
  // every player on the owning team submits independently — nobody buzzes for
  // a bonus — so without this guard two teammates hitting Enter together would
  // each score it, and the second would overwrite the first team's answer in
  // the log. Both branches of updateEntity run in one synchronous critical
  // section, so the first write really is the first submission.
  //
  // A tossup is *not* over on a wrong answer — it reopens for the other teams —
  // so only a correct one closes it.
  if (bs.dead || (isBonus ? !!bs.result : bs.result === 'correct')) {
    return { session, patch: null, rejected: 'this question is already resolved' };
  }

  // Where the reading was frozen, if it was: the buzz instant for a buzzed
  // tossup, the host's pause otherwise. Used below to carry the reading on from
  // that word when the question reopens.
  const frozenSince = bs.paused_at || bs.buzzed_at || null;

  // A bonus belongs to the team (free-for-all: the player) that won the tossup.
  // Enforced here and not only in the UI, since the UI merely hides the box.
  if (isBonus && (bs.bonus_for_team || bs.bonus_for_player_id)) {
    const mine = bs.bonus_for_team
      ? bs.bonus_for_team === team
      : bs.bonus_for_player_id === playerId;
    if (!mine) {
      return { session, patch: null, rejected: 'this bonus belongs to another team' };
    }
  }

  const isCorrect = result === 'correct';
  const isNeg = result === 'interrupt_wrong';
  const powers = !!session.settings?.powers;
  const pts = pointsFor({ result, type, interrupted, powers });

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
    interrupted: !!interrupted,
    // Carried so the points log can show what was actually said, and tell a
    // wrong answer apart from a question nobody answered.
    submitted_answer: submittedAnswer ?? null,
    submitted_choice: submittedChoice ?? null,
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
    // Tossup missed: lock out this team/player and reopen for everyone else —
    // unless the question has now taken enough wrong answers to be dead.
    const negged_teams = [...(bs.negged_teams || [])];
    if (team && !negged_teams.includes(team)) negged_teams.push(team);
    const negged_players = [...(bs.negged_players || [])];
    if (!negged_players.includes(playerId)) negged_players.push(playerId);

    // Counted as attempts rather than derived from negged_players, so it holds
    // in team play (where two players on locked-out teams are still two wrong
    // answers) and doesn't miscount a player who somehow answers twice.
    const wrong_count = (bs.wrong_count || 0) + 1;
    const wrongLimit = wrongLimitFor(questionFormat || bs.question_format);
    const exhausted = roomExhausted(session, {
      neggedTeams: negged_teams, neggedPlayers: negged_players,
    });
    const dead = wrong_count >= wrongLimit || exhausted;

    buzz_state = {
      buzzed_player_id: null, buzzed_team: null, buzzed_display_name: null,
      result: isNeg ? 'neg' : 'wrong',
      result_player: displayName, result_player_id: playerId,
      result_team: team || '',
      result_points: pts, result_interrupted: isNeg,
      bonus_for_team: null, bonus_for_player: null, bonus_for_player_id: null,
      negged_teams, negged_players,
      wrong_count,
      wrong_limit: wrongLimit,
      question_format: questionFormat || bs.question_format || '',
      // The question reopens for the other teams, so the reading resumes from
      // the word it was frozen on rather than jumping forward by however long
      // this player held the buzz.
      reading_started_at: readingResumedAt(bs, frozenSince),
      paused_at: null,
      // Nobody can win it any more: no bonus is awarded and the room moves on.
      dead,
      dead_reason: dead
        ? (wrong_count >= wrongLimit ? 'wrong_limit' : 'all_answered')
        : null,
    };
  }

  const patch = { players, teams, buzz_state, question_results };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

// How long a player may hold the buzz before any client may release it on their
// behalf. The reader gives them 10s to answer; the rest is slack for the round
// trip and for clock error between machines.
export const ANSWER_GRACE_MS = 10_000;
export const STALE_BUZZ_MS = ANSWER_GRACE_MS + 5_000;

/**
 * Release a buzz whose holder never answered — a closed laptop, a frozen tab, a
 * dropped connection. Without this the room is locked out permanently: nobody
 * else may buzz while a buzz is held, and the question can never resolve, so
 * there is nothing left to click.
 *
 * Recorded as an unanswered attempt by that player, which is exactly what it
 * was: they are locked out, it counts toward the wrong-answer limit, and the
 * question reopens for everyone else (or dies, by the usual rules).
 *
 * Idempotent and self-guarding: every client reports, and a report that arrives
 * after the player actually answered — or before the buzz is stale — does
 * nothing.
 */
export function applyStaleBuzzRelease(sessionId, {
  isBonus = false, questionFormat = '', now = Date.now(), staleMs = STALE_BUZZ_MS,
} = {}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};
  if (!bs.buzzed_player_id || bs.result || bs.dead) return { session, patch: null };
  // A stopped match is not a frozen tab. While the host has it paused the hold
  // cannot go stale, however long it lasts — releasing here would score a neg
  // against a player for a pause they did not ask for. `applyPause` moves
  // `buzzed_at` forward on resume, so the window carries on rather than
  // restarting or having quietly expired.
  if (bs.paused_at) return { session, patch: null };
  const heldSince = bs.buzzed_at || bs.reading_started_at || 0;
  if (heldSince && now - heldSince < staleMs) return { session, patch: null };

  return applyAnswer(sessionId, {
    playerId: bs.buzzed_player_id,
    displayName: bs.buzzed_display_name || 'Player',
    team: bs.buzzed_team || '',
    result: 'timeout',
    type: isBonus ? 'BONUS' : 'TOSSUP',
    interrupted: false,
    questionFormat: questionFormat || bs.question_format || '',
  });
}

/** Tossup timer elapsed, or everyone has already missed it. */
export function applyDead(sessionId, { isBonus = false } = {}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};
  if (bs.result === 'correct' || bs.dead) return { session, patch: null };

  const allAnswered = roomExhausted(session, {
    neggedTeams: bs.negged_teams || [], neggedPlayers: bs.negged_players || [],
  });

  const patch = {
    buzz_state: {
      ...bs,
      buzzed_player_id: null,
      buzzed_team: null,
      buzzed_display_name: null,
      pending_buzz: null,
      paused_at: null,
      // A timed-out bonus resolves as wrong: bonuses have no reopen semantics,
      // and without a result the match could never advance past it.
      result: (allAnswered || isBonus) ? 'wrong' : null,
      dead: true,
      dead_reason: allAnswered ? 'all_answered' : 'timeout',
    },
  };

  // A question nobody ever answered still happened, so it belongs in the
  // question log with a zero against it — otherwise the log skips a number and
  // there is nothing to click to read the question back. Only when nothing is
  // logged for it already: a tossup that died on its wrong-answer limit has
  // every one of those answers recorded, and a second "dead" row would double
  // it up. Every client reports a dead question, so this must be idempotent —
  // the early return above is what makes it so.
  const index = session.current_question_index || 0;
  if (!isLogged(session, index)) {
    patch.question_results = [
      ...(session.question_results || []),
      unansweredLogEntry(index, isBonus ? 'BONUS' : 'TOSSUP'),
    ];
  }

  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Advance to the next question. `nextIndex` is computed by the caller (the
 * client knows the filtered question list), but the timestamp is stamped here
 * so every client derives its reading position from the same clock.
 */
export function applyAdvance(sessionId, {
  nextIndex, keepBonusOwner = false, finished = false, currentType = '',
}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};

  // The question being left behind, if it was played and never logged — one
  // that timed out on a client that dropped before reporting, say. Worth zero,
  // like any question nobody answered, but it has to appear: a log that omits
  // it reads as though the room jumped a question.
  const leavingIndex = session.current_question_index || 0;
  const logLeftBehind = bs.reading_started_at && !isLogged(session, leavingIndex)
    ? [...(session.question_results || []), unansweredLogEntry(leavingIndex, currentType)]
    : null;

  if (finished) {
    const patch = { status: 'finished', buzz_state: null, end_vote: null };
    if (logLeftBehind) patch.question_results = logLeftBehind;
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
  if (logLeftBehind) patch.question_results = logLeftBehind;
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Pause or resume the reading for the whole room (host only — enforced in the
 * route). A pause has to be shared: a local one would only stop this player's
 * words while everyone else's carried on, and the buzzer stayed live.
 *
 * Resuming shifts `reading_started_at` forward by the paused interval rather
 * than storing an accumulated total, so the one formula every client derives
 * its word position from — `now - reading_started_at` — stays correct with
 * nothing extra to keep in step.
 */
export function applyPause(sessionId, { paused }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const bs = session.buzz_state || {};
  // Nothing to pause once the question is over, and a pause held across the
  // advance would freeze the next one.
  if (questionClosed(bs)) return { session, patch: null };

  if (paused) {
    if (bs.paused_at) return { session, patch: null };
    const patch = { buzz_state: { ...bs, paused_at: Date.now() } };
    return { session: updateEntity('GameSession', sessionId, patch), patch };
  }

  if (!bs.paused_at) return { session, patch: null };
  const pausedFor = Math.max(0, Date.now() - bs.paused_at);
  const patch = {
    buzz_state: {
      ...bs,
      paused_at: null,
      reading_started_at: readingResumedAt(bs, bs.paused_at),
      // A buzz held across the pause has to have its clock moved on too, or the
      // player who buzzed comes back with less time to answer than they had —
      // and if the pause ran past STALE_BUZZ_MS, the watchdog would neg them
      // for the interruption the moment play resumed.
      buzzed_at: bs.buzzed_at ? bs.buzzed_at + pausedFor : bs.buzzed_at,
    },
  };
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
    // A request left over from the previous game would be standing over this one.
    end_vote: null,
  };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

// ── Ending a marathon ───────────────────────────────────────────────────────
//
// A round of practice ends when the packet does. A marathon doesn't end at all
// — it draws question k from (seed, k) forever — so it needs a way to be
// stopped, and that used to be a host button. Handing one player the power to
// end everyone else's game is the thing that was wrong with it, so this is a
// request the room agrees to instead:
//
//   • alone in the room, there is nobody to ask — it just ends;
//   • otherwise every other player has to accept, and a single decline drops
//     it. Unanimous rather than a majority because the cost of a "no" is only
//     that the game carries on, which is what everyone signed up for.
//
// The requester counts as having accepted, so "resolved" is one condition —
// everyone on the roster has accepted — which also means a hold-out who leaves
// releases the vote instead of stranding it.

/** How long a request stands before it lapses. */
export const END_VOTE_MS = 60_000;

function endVoteExpired(vote, now = Date.now()) {
  return !!vote && now - (vote.requested_at || 0) >= END_VOTE_MS;
}

/** Has everyone still in the room accepted? */
function endVoteAgreed(session, vote) {
  const roster = (session.players || []).map(p => p.user_id);
  if (roster.length === 0) return true;
  return roster.every(id => (vote.accepted || []).includes(id));
}

function finishMatch(sessionId, session, currentType) {
  const patch = { status: 'finished', buzz_state: null, end_vote: null };
  const leavingIndex = session.current_question_index || 0;
  if (session.buzz_state?.reading_started_at && !isLogged(session, leavingIndex)) {
    patch.question_results = [
      ...(session.question_results || []),
      unansweredLogEntry(leavingIndex, currentType),
    ];
  }
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Ask the room to end the marathon — or just end it, when there is nobody else
 * left to ask.
 */
export function applyEndRequest(sessionId, { playerId, displayName, currentType = '' }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  if (session.status !== 'active') return { session, patch: null };

  const roster = session.players || [];
  const others = roster.filter(p => p.user_id !== playerId);
  if (others.length === 0) return finishMatch(sessionId, session, currentType);

  // A request already standing is left alone, so pressing the button twice
  // doesn't wipe the accepts that have come in.
  const live = session.end_vote;
  if (live && !endVoteExpired(live)) return { session, patch: null };

  const patch = {
    end_vote: {
      requested_by: playerId,
      requested_by_name: displayName || 'A player',
      requested_at: Date.now(),
      // Asking is agreeing — which makes "everyone has accepted" the single
      // condition that ends it, however the roster changes underneath.
      accepted: [playerId],
      declined_by: null,
    },
  };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/** Accept or decline a standing request. */
export function applyEndVote(sessionId, { playerId, displayName, accept, currentType = '' }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const vote = session.end_vote;
  if (!vote || session.status !== 'active') return { session, patch: null };
  if (endVoteExpired(vote)) {
    const patch = { end_vote: null };
    return { session: updateEntity('GameSession', sessionId, patch), patch };
  }

  if (!accept) {
    // One "no" is enough: the alternative is playing on, which is nobody's
    // loss. Named so the room can see who, rather than the request simply
    // evaporating.
    const patch = {
      end_vote: {
        ...vote,
        declined_by: displayName || 'A player',
        declined_at: Date.now(),
      },
    };
    return { session: updateEntity('GameSession', sessionId, patch), patch };
  }

  const accepted = vote.accepted?.includes(playerId)
    ? vote.accepted
    : [...(vote.accepted || []), playerId];
  const next = { ...vote, accepted };
  if (endVoteAgreed(session, next)) return finishMatch(sessionId, session, currentType);

  const patch = { end_vote: next };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Withdraw a request, or clear one that has lapsed. Any client may report the
 * lapse — the timestamp is checked here, so a report that races an accept does
 * nothing (the same shape as applyStaleBuzzRelease).
 */
export function applyEndVoteClear(sessionId, { playerId = null, force = false } = {}) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return null;
  const vote = session.end_vote;
  if (!vote) return { session, patch: null };
  const mine = playerId && vote.requested_by === playerId;
  const done = !!vote.declined_by;
  if (!force && !mine && !done && !endVoteExpired(vote)) return { session, patch: null };
  const patch = { end_vote: null };
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}

/**
 * Re-check a standing request after the roster changed. The player everyone was
 * waiting on may have just left, and a vote that can never complete would keep
 * the room looking at a prompt nobody can resolve.
 */
export function resolveEndVoteAfterLeave(sessionId) {
  const session = getEntity('GameSession', sessionId);
  const vote = session?.end_vote;
  if (!session || !vote || session.status !== 'active') return null;
  if (endVoteExpired(vote)) return applyEndVoteClear(sessionId, { force: true });
  // The requester left: their request goes with them.
  if (!(session.players || []).some(p => p.user_id === vote.requested_by)) {
    return applyEndVoteClear(sessionId, { force: true });
  }
  if (endVoteAgreed(session, vote)) return finishMatch(sessionId, session, '');
  return null;
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
    end_vote: null,
    question_results: [],
    players: (session.players || []).map(p => (resetScores ? { ...p, score: 0, answers: [] } : p)),
    teams: (session.teams || []).map(t => (resetScores ? { ...t, score: 0 } : t)),
  };
  if (gameType) patch.game_type = gameType;
  return { session: updateEntity('GameSession', sessionId, patch), patch };
}
