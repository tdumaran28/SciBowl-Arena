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
  // Display only. Buzzing is deliberately NOT captain-gated: a tossup is
  // individual in Science Bowl, any player may take it, and `captain_id` is
  // assigned once — to whoever typed the team name — and never reassigned.
  // Gating the buzzer on it meant only that one player could ever buzz for the
  // team, and a room whose captain closed their laptop left their whole team
  // unable to buzz for the rest of the match with no way to recover.
  const isCaptain = myTeamDef ? myTeamDef.captain_id === myPlayerId : true;
  const isFFA = teams.length === 0;

  const isTossupQ = question?.type === 'TOSSUP';
  const isBonusQ = question?.type === 'BONUS';

  // Team games lock out by team; free-for-all locks out by player.
  const iAmNegged = isFFA
    ? !!bs?.negged_players?.includes(myPlayerId)
    : !!(myTeam && bs?.negged_teams?.includes(myTeam));

  // A bonus belongs to whoever the tossup was won FOR: a team when the winner
  // had one, otherwise that player. Keyed on the bonus rather than on whether
  // the room has teams at all, because a room can have teams and still have
  // players who haven't joined one (TeamPanel lists them under "No Team") — and
  // reading their bonus as a team bonus with no team meant the player who had
  // just won it was locked out of their own bonus, with nobody else allowed it
  // either.
  const bonusIsForTeam = !!bs?.bonus_for_team;
  const bonusIsMine = bonusIsForTeam
    ? !!(myTeam && bs.bonus_for_team === myTeam)
    : bs?.bonus_for_player_id === myPlayerId;
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

  const present = (id) => !id || players.some(p => p.user_id === id);

  // Is anyone who could answer this bonus still in the room?
  //
  // A bonus belongs to the TEAM that won the tossup, not to the player who
  // buzzed it, so it survives that player leaving as long as a teammate is
  // still here — and conversely it is unanswerable once the whole team has
  // gone, however present the rest of the room is. Free-for-all has no team, so
  // there it really is the one player.
  const bonusOwnerPresent = bonusIsForTeam
    ? players.some(p => p.team === bs.bonus_for_team)
    : present(bs?.bonus_for_player_id);

  // Dead: the timer elapsed with no correct answer, everyone has missed it, or
  // it has taken its format's limit of wrong answers (2 multiple choice, 3 short
  // answer — server/match.js owns the rule; mirrored here so the lockout shows
  // the instant this client sees the answer rather than a frame later).
  const allTeamsAnswered = teams.length > 0 && teams.every(t => bs?.negged_teams?.includes(t.name));
  const allPlayersAnswered = isFFA && players.length > 0 &&
    players.every(p => bs?.negged_players?.includes(p.user_id));
  const wrongLimit = wrongLimitFor(question?.format);
  const hitWrongLimit = isTossupQ && (bs?.wrong_count || 0) >= wrongLimit;
  // A bonus only exists for the team that earned it, so there are two ways for
  // it to have nobody left who may answer — and both have to read as dead, or
  // the room is looking at a question that no one on it is allowed to touch.
  // (An unowned bonus should never be shown at all: the advance path skips it.
  // This is the backstop for if one ever is.)
  const bonusUnanswerable = isBonusQ && (!bonusEarned || !bonusOwnerPresent);
  const questionDead = !!bs?.dead || hitWrongLimit || allTeamsAnswered ||
    allPlayersAnswered || bonusUnanswerable;

  // Resolved: dead, or answered — where a tossup is only "answered" by a
  // CORRECT answer (a wrong one leaves it live for the other teams) while a
  // bonus is answered either way, since nobody else was going to get it.
  const resolved = questionDead || (isBonusQ ? !!bs?.result : bs?.result === 'correct');

  // Bonuses are not buzzed. Every player on the owning team gets an open answer
  // box for the whole bonus window and the first one to submit is the team's
  // answer — which is how a team actually plays a bonus, conferring and then
  // one of them saying it. Arbitrating a buzz here would instead have the first
  // teammate to press the button lock the other three out of their own bonus.
  const canAnswerBonus = isBonusQ && bonusEarned && bonusIsMine && !resolved;
  const canBuzz = !isBonusQ &&
    !resolved &&
    !someoneElseBuzzed &&
    !iAmNegged &&
    !isBonusForOther &&
    !iAmBuzzing;

  // Advancing. A dead question is advanceable by ANYONE, unconditionally — that
  // is the escape hatch that keeps a match from wedging, so it depends on
  // nothing but the question being over. On a correct answer the winner
  // advances (they own the bonus that follows), with fallbacks so the room can
  // always move: the host, and anyone at all once whoever the room is waiting
  // on is no longer here.
  // Same rule as bonus ownership: a result recorded against a team is the whole
  // team's, and one recorded against nobody's team is that player's — so a
  // player with no team can still advance the tossup they just won.
  const iWonThis = bs?.result_team
    ? !!(myTeam && bs.result_team === myTeam)
    : bs?.result_player_id === myPlayerId;
  const waitingOnAbsentee = bonusUnanswerable || !present(bs?.buzzed_player_id);
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
    bonusOwnerPresent, bonusUnanswerable, canAnswerBonus,
    someoneElseBuzzed, iAmBuzzing, pendingBuzz, buzzerName,
    questionDead, resolved, wrongLimit, canBuzz, canAdvance, revealAnswer,
    iWonThis, waitingOnAbsentee,
  };
}
