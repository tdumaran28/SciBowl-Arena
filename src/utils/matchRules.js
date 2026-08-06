// What a multiplayer question looks like to one player: may I buzz, is it over,
// may I move the match on, and can I be shown the answer yet.
//
// This lives apart from the view for two reasons. It is the half of the rules
// the client evaluates locally — the server owns the transitions, but the UI
// cannot wait a round trip to decide whether to keep the buzzer live — and it
// is the part where a softlock hides: every "nobody can act now" bug is a
// disagreement between these booleans. Pure and dependency-free, so
// server/match.test.js drives the real thing rather than a copy of it.

import { wrongLimitFor } from './parseRound.js';

/**
 * @param session   the GameSession as this client currently holds it
 * @param myPlayerId  this player's id
 * @param question  the question being played (for type and format)
 */
export function deriveMatchState({ session, myPlayerId, question }) {
  const bs = session?.buzz_state || null;
  const players = session?.players || [];
  const teams = session?.teams || [];
  const me = players.find(p => p.user_id === myPlayerId);
  const myTeam = me?.team || '';
  const myTeamDef = teams.find(t => t.name === myTeam);

  const isHost = session?.host_id === myPlayerId;
  const isCaptain = myTeamDef ? myTeamDef.captain_id === myPlayerId : true; // no team = can buzz
  const isFFA = teams.length === 0;

  const isTossupQ = question?.type === 'TOSSUP';
  const isBonusQ = question?.type === 'BONUS';

  // Team games lock out by team; free-for-all locks out by player, and the
  // bonus belongs to the specific winning player.
  const iAmNegged = isFFA
    ? !!bs?.negged_players?.includes(myPlayerId)
    : !!(myTeam && bs?.negged_teams?.includes(myTeam));
  const bonusIsMine = isFFA
    ? bs?.bonus_for_player_id === myPlayerId
    : !!(myTeam && bs?.bonus_for_team === myTeam);
  const bonusEarned = !!(bs?.bonus_for_team || bs?.bonus_for_player_id || bs?.bonus_for_player);
  const isBonusForOther = bonusEarned && !bonusIsMine;

  // A provisional lock: a claim that reached the server but has not yet cleared
  // arbitration. Treated exactly like a settled buzz — that is what takes the
  // lockout delay down to a single network hop — and replaced by the
  // authoritative frame when the window closes.
  const pendingBuzz = !bs?.result && !bs?.dead ? (bs?.pending_buzz || null) : null;
  const someoneElseBuzzed = !!(
    (bs?.buzzed_player_id && bs.buzzed_player_id !== myPlayerId && !bs.result) ||
    (pendingBuzz && pendingBuzz.player_id !== myPlayerId && !bs?.buzzed_player_id)
  );
  const iAmBuzzing = !!(
    (bs?.buzzed_player_id === myPlayerId && !bs.result) ||
    (pendingBuzz && pendingBuzz.player_id === myPlayerId && !bs?.buzzed_player_id)
  );
  const buzzerName = bs?.buzzed_display_name || pendingBuzz?.display_name || null;

  // Dead: the timer elapsed with no correct answer, everyone has missed it, or
  // it has taken its format's limit of wrong answers (2 multiple choice, 3 short
  // answer — server/match.js owns the rule; mirrored here so the lockout shows
  // the instant this client sees the answer rather than a frame later).
  const allTeamsAnswered = teams.length > 0 && teams.every(t => bs?.negged_teams?.includes(t.name));
  const allPlayersAnswered = isFFA && players.length > 0 &&
    players.every(p => bs?.negged_players?.includes(p.user_id));
  const wrongLimit = wrongLimitFor(question?.format);
  const hitWrongLimit = isTossupQ && (bs?.wrong_count || 0) >= wrongLimit;
  const questionDead = !!bs?.dead || hitWrongLimit || allTeamsAnswered || allPlayersAnswered;

  // Resolved: a tossup answered correctly or dead; a bonus answered either way.
  const resolved = isTossupQ ? (bs?.result === 'correct' || questionDead) : !!bs?.result;

  const canBuzz = !resolved &&
    !someoneElseBuzzed &&
    !iAmNegged &&
    !isBonusForOther &&
    isCaptain &&
    !iAmBuzzing;

  // Advancing. A dead question is advanceable by ANYONE, unconditionally — that
  // is the escape hatch that keeps a match from wedging, so it depends on
  // nothing but the question being over. On a correct answer the winner
  // advances (they own the bonus that follows), with fallbacks so the room can
  // always move: the host, and anyone at all once whoever the room is waiting
  // on is no longer here.
  const present = (id) => !id || players.some(p => p.user_id === id);
  const iWonThis = isFFA
    ? bs?.result_player_id === myPlayerId
    : !!(myTeam && bs?.result_team === myTeam);
  const waitingOnAbsentee =
    (isBonusQ && bonusEarned && !present(bs?.bonus_for_player_id)) ||
    !present(bs?.buzzed_player_id);
  const canAdvance = questionDead ||
    waitingOnAbsentee ||
    isHost ||
    (resolved && (
      (bs?.result === 'correct' && iWonThis) ||
      (isBonusQ && !!bs?.result && (iWonThis || bonusIsMine)) ||
      !present(bs?.result_player_id)
    ));

  // The correct answer is handed to the UI only once the question is over for
  // EVERYONE. A wrong answer leaves a tossup live for the other teams, and
  // showing the answer then would end it.
  const revealAnswer = resolved;

  return {
    isHost, isCaptain, isFFA, myTeam,
    isTossupQ, isBonusQ,
    iAmNegged, bonusIsMine, bonusEarned, isBonusForOther,
    someoneElseBuzzed, iAmBuzzing, pendingBuzz, buzzerName,
    questionDead, resolved, wrongLimit, canBuzz, canAdvance, revealAnswer,
    iWonThis, waitingOnAbsentee,
  };
}
