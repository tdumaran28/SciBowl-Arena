// Multiplayer match-engine tests: node --test server/
//
// These cover the rules a room depends on to keep moving — who may buzz, when a
// question dies, what the answer reveal is gated on, and every path that has
// ever threatened to leave a match with nothing left to click. The client
// mirrors these rules for responsiveness, but this module is the authority, so
// this is where they are pinned down.
//
// The datastore is a JSON file resolved from process.cwd(), so the whole suite
// runs in a temp directory: it must never touch a real server/data/db.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scibowl-match-'));
process.chdir(tmp);

const { createEntity, getEntity } = await import('./db.js');
const {
  applyAnswer, applyDead, applyAdvance, applyStart, applyStaleBuzzRelease, applyPause,
  applyEndRequest, applyEndVote, applyEndVoteClear, resolveEndVoteAfterLeave,
  STALE_BUZZ_MS, END_VOTE_MS, SCORING,
} = await import('./match.js');
// The client's half of the rules — the actual module the multiplayer view
// renders from, not a copy of it. A softlock is a disagreement between the two
// halves, so both are driven here from the same states.
const { deriveMatchState } = await import('../src/utils/matchRules.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession({ settings = {}, teams = [], playerIds = ['a', 'b', 'c', 'd'] } = {}) {
  const players = playerIds.map(id => ({
    user_id: id,
    display_name: id.toUpperCase(),
    score: 0,
    team: teams.find(t => t.captain_id === id)?.name || '',
  }));
  return createEntity('GameSession', {
    mode: 'multiplayer',
    status: 'active',
    settings,
    teams: teams.map(t => ({ ...t, score: 0 })),
    players,
    current_question_index: 0,
    buzz_state: { reading_started_at: Date.now() },
    question_results: [],
  });
}

const buzz = (id, { player, team = '', at = Date.now() }) => {
  // The arbitration window itself is timing-dependent; these tests drive the
  // settled state it produces, which is what the rest of the engine reads.
  const s = getEntity('GameSession', id);
  const bs = s.buzz_state || {};
  s.buzz_state = {
    ...bs,
    buzzed_player_id: player,
    buzzed_team: team,
    buzzed_display_name: player.toUpperCase(),
    buzzed_at: at,
    pending_buzz: null,
    result: null,
  };
  return s;
};

const answer = (id, player, result, extra = {}) => applyAnswer(id, {
  playerId: player,
  displayName: player.toUpperCase(),
  team: extra.team || '',
  result,
  type: extra.type || 'TOSSUP',
  interrupted: !!extra.interrupted,
  submittedAnswer: extra.submittedAnswer ?? null,
  submittedChoice: extra.submittedChoice ?? null,
  questionFormat: extra.format || 'Short Answer',
}).session;

/**
 * What one player's screen makes of a session — evaluated by the same module
 * the multiplayer view uses, so these assertions are about what a player can
 * actually do, not merely about what the store holds.
 */
function clientView(session, { myPlayerId, questionFormat = 'Short Answer', isBonus = false }) {
  const state = deriveMatchState({
    session,
    myPlayerId,
    question: { type: isBonus ? 'BONUS' : 'TOSSUP', format: questionFormat },
  });
  return {
    dead: state.questionDead,
    resolved: state.resolved,
    canBuzz: state.canBuzz,
    // Bonuses are not buzzed — the owning team all get an open answer box, so
    // this is the "may I put an answer in" of a bonus.
    canAnswerBonus: state.canAnswerBonus,
    canAdvance: state.canAdvance,
    revealsAnswer: state.revealAnswer,
    lockedByOther: state.someoneElseBuzzed,
  };
}

// ── Wrong-answer limits ─────────────────────────────────────────────────────

test('multiple choice tossup dies on the second wrong answer', () => {
  const s = makeSession();
  let cur = answer(s.id, 'a', 'wrong', { format: 'Multiple Choice' });
  assert.equal(cur.buzz_state.dead, false, 'alive after one');
  assert.equal(clientView(cur, { myPlayerId: 'b', questionFormat: 'Multiple Choice' }).canBuzz, true);

  cur = answer(s.id, 'b', 'wrong', { format: 'Multiple Choice' });
  assert.equal(cur.buzz_state.dead, true);
  assert.equal(cur.buzz_state.dead_reason, 'wrong_limit');

  const c = clientView(cur, { myPlayerId: 'c', questionFormat: 'Multiple Choice' });
  assert.equal(c.canBuzz, false, 'a dead question takes no more buzzes');
  assert.equal(c.canAdvance, true, 'anyone may advance a dead question');
});

test('short answer tossup survives two wrong answers and dies on the third', () => {
  const s = makeSession();
  answer(s.id, 'a', 'wrong');
  let cur = answer(s.id, 'b', 'interrupt_wrong', { interrupted: true });
  assert.equal(cur.buzz_state.dead, false);
  assert.equal(clientView(cur, { myPlayerId: 'c' }).canBuzz, true);

  cur = answer(s.id, 'c', 'wrong');
  assert.equal(cur.buzz_state.dead, true);
  assert.equal(clientView(cur, { myPlayerId: 'd' }).canBuzz, false);
});

test('wrong answers by locked-out teams still count toward the limit', () => {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'b' }, { name: 'Green', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c'] });
  answer(s.id, 'a', 'wrong', { team: 'Red', format: 'Multiple Choice' });
  const cur = answer(s.id, 'b', 'wrong', { team: 'Blue', format: 'Multiple Choice' });
  assert.equal(cur.buzz_state.dead, true, 'dead at two even though Green never answered');
  assert.equal(clientView(cur, { myPlayerId: 'c', questionFormat: 'Multiple Choice' }).canBuzz, false);
});

// ── Answer reveal gating ────────────────────────────────────────────────────

test('a wrong answer does not reveal the answer while the question is live', () => {
  const s = makeSession();
  const cur = answer(s.id, 'a', 'wrong');
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: id }).revealsAnswer, false,
      `answer must stay hidden from ${id} while the question is open`);
  }
});

test('the answer is revealed to everyone once the question dies', () => {
  const s = makeSession();
  answer(s.id, 'a', 'wrong');
  answer(s.id, 'b', 'wrong');
  const cur = answer(s.id, 'c', 'wrong');
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: id }).revealsAnswer, true);
  }
});

test('the answer is revealed once someone gets it right', () => {
  const s = makeSession();
  answer(s.id, 'a', 'wrong');
  const cur = answer(s.id, 'b', 'correct');
  assert.equal(clientView(cur, { myPlayerId: 'd' }).revealsAnswer, true);
});

// ── Scoring ─────────────────────────────────────────────────────────────────

test('powers score a correct interrupt above a normal tossup', () => {
  const withPowers = makeSession({ settings: { powers: true } });
  let cur = answer(withPowers.id, 'a', 'correct', { interrupted: true });
  assert.equal(cur.players.find(p => p.user_id === 'a').score, SCORING.TOSSUP_POWER);

  const without = makeSession();
  cur = answer(without.id, 'a', 'correct', { interrupted: true });
  assert.equal(cur.players.find(p => p.user_id === 'a').score, SCORING.TOSSUP_CORRECT);
});

test('a boss-up scores as a tossup (the client sends it as one)', () => {
  const s = makeSession({ settings: { boss_ups: true, powers: true } });
  const cur = answer(s.id, 'a', 'correct', { type: 'TOSSUP', interrupted: true });
  assert.equal(cur.players.find(p => p.user_id === 'a').score, SCORING.TOSSUP_POWER);
  assert.equal(cur.buzz_state.result, 'correct');
});

test('the points log records what was submitted', () => {
  const s = makeSession();
  const cur = answer(s.id, 'a', 'wrong', { submittedAnswer: 'X', submittedChoice: 'X', format: 'Multiple Choice' });
  const entry = cur.question_results.at(-1);
  assert.equal(entry.submitted_choice, 'X');
  assert.equal(entry.kind, 'wrong');
});

test('a buzzed player who runs out of time is logged with no answer', () => {
  const s = makeSession();
  const cur = answer(s.id, 'a', 'timeout');
  const entry = cur.question_results.at(-1);
  assert.equal(entry.submitted_answer, null);
  assert.equal(entry.points, 0);
});

// ── Buzz ownership ──────────────────────────────────────────────────────────

test('a player cannot answer over someone else’s buzz', () => {
  const s = makeSession();
  buzz(s.id, { player: 'a' });
  const outcome = applyAnswer(s.id, {
    playerId: 'b', displayName: 'B', team: '', result: 'correct', type: 'TOSSUP',
  });
  assert.equal(outcome.rejected, 'another player holds the buzz');
  assert.equal(outcome.patch, null);
  assert.equal(outcome.session.players.find(p => p.user_id === 'b').score, 0);
});

// ── Team play ───────────────────────────────────────────────────────────────
//
// `captain_id` is assigned once, to whoever typed the team name, and is never
// reassigned — so anything that gates play on it gates play on one specific
// person being present and awake. It is a display marker only.

test('every player on a team may buzz, not just the captain', () => {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));

  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(live, { myPlayerId: id }).canBuzz, true,
      `${id} must be able to buzz a live tossup`);
  }
});

test('a team whose captain has left can still buzz', () => {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));
  // The captain closes their laptop; the leave route drops them from the roster
  // but leaves `teams` (and its stale captain_id) alone.
  live.players = live.players.filter(p => p.user_id !== 'a');

  assert.equal(clientView(live, { myPlayerId: 'b' }).canBuzz, true,
    'Red must not be locked out of the rest of the match by its captain leaving');
});

test('a team lockout still applies to the whole team', () => {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));

  const cur = answer(s.id, 'b', 'wrong', { team: 'Red' });
  assert.equal(clientView(cur, { myPlayerId: 'a' }).canBuzz, false, 'A is negged with their team');
  assert.equal(clientView(cur, { myPlayerId: 'b' }).canBuzz, false);
  assert.equal(clientView(cur, { myPlayerId: 'd' }).canBuzz, true, 'Blue is still open');
});

// ── Bonuses ─────────────────────────────────────────────────────────────────
//
// A bonus belongs to the TEAM that won the tossup. All of them get an open
// answer box for the whole window — no buzz, because arbitrating one would let
// the first teammate to press the button lock the other three out of their own
// bonus — and the first submission to reach the server is the team's answer.

/** A room of two teams: Red = a, b (a won it) / Blue = c, d — on the bonus. */
function bonusForRed() {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));
  answer(s.id, 'a', 'correct', { team: 'Red' });
  applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true });
  return s.id;
}

const answerBonus = (id, player, result, team) =>
  applyAnswer(id, {
    playerId: player, displayName: player.toUpperCase(), team,
    result, type: 'BONUS', questionFormat: 'Short Answer',
  });

test('a team bonus is answerable by every member of that team and nobody else', () => {
  const id = bonusForRed();
  const cur = getEntity('GameSession', id);

  for (const p of ['a', 'b']) {
    const v = clientView(cur, { myPlayerId: p, isBonus: true });
    assert.equal(v.canAnswerBonus, true, `${p} is on the team that earned it`);
    assert.equal(v.canBuzz, false, 'a bonus is not buzzed');
  }
  for (const p of ['c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: p, isBonus: true }).canAnswerBonus, false,
      `${p} is on the other team`);
  }
});

test('the first bonus answer from the team is the one that counts', () => {
  const id = bonusForRed();

  // B answers correctly first; A is a beat behind with a wrong one.
  const first = answerBonus(id, 'b', 'correct', 'Red');
  assert.equal(first.rejected, undefined);
  assert.equal(first.session.buzz_state.result, 'correct');

  const second = answerBonus(id, 'a', 'wrong', 'Red');
  assert.equal(second.rejected, 'this question is already resolved');
  assert.equal(second.patch, null);

  const cur = getEntity('GameSession', id);
  assert.equal(cur.teams.find(t => t.name === 'Red').score, SCORING.TOSSUP_CORRECT + SCORING.BONUS_CORRECT,
    'the bonus is scored once, not once per teammate');
  assert.equal(cur.question_results.filter(r => r.type === 'BONUS').length, 1,
    'and appears once in the points log');
  assert.equal(cur.question_results.at(-1).player, 'B', 'logged against whoever got it in first');
});

test('a losing race does not turn a correct bonus into a wrong one', () => {
  const id = bonusForRed();
  answerBonus(id, 'b', 'wrong', 'Red');            // B is first, and wrong
  const late = answerBonus(id, 'a', 'correct', 'Red');
  assert.equal(late.rejected, 'this question is already resolved');
  assert.equal(getEntity('GameSession', id).buzz_state.result, 'wrong');
  assert.equal(getEntity('GameSession', id).teams.find(t => t.name === 'Red').score,
    SCORING.TOSSUP_CORRECT, 'no bonus points');
});

test('the other team cannot answer a bonus even by asking the server directly', () => {
  const id = bonusForRed();
  const outcome = answerBonus(id, 'c', 'correct', 'Blue');
  assert.equal(outcome.rejected, 'this bonus belongs to another team');
  assert.equal(getEntity('GameSession', id).teams.find(t => t.name === 'Blue').score, 0);
});

test('a bonus survives the player who won it leaving, as long as a teammate is here', () => {
  const id = bonusForRed();
  const cur = getEntity('GameSession', id);
  cur.players = cur.players.filter(p => p.user_id !== 'a');   // A (who won it) leaves

  const v = clientView(cur, { myPlayerId: 'b', isBonus: true });
  assert.equal(v.dead, false, 'Red still has B');
  assert.equal(v.canAnswerBonus, true, 'and the bonus is still theirs to answer');
  assert.equal(clientView(cur, { myPlayerId: 'c', isBonus: true }).canAnswerBonus, false);
});

test('a bonus whose whole team has left is dead and advanceable by anyone', () => {
  const id = bonusForRed();
  const cur = getEntity('GameSession', id);
  cur.host_id = 'c';
  cur.players = cur.players.filter(p => !['a', 'b'].includes(p.user_id));  // all of Red leaves

  for (const p of ['c', 'd']) {
    const v = clientView(cur, { myPlayerId: p, isBonus: true });
    assert.equal(v.dead, true, `${p} sees a bonus nobody can answer as dead`);
    assert.equal(v.canAnswerBonus, false, 'and cannot answer it themselves');
    assert.equal(v.canAdvance, true, `${p} may move the room on`);
    assert.equal(v.revealsAnswer, true, 'the question is over, so the answer is shown');
  }
});

test('a bonus nobody answered in time is dead and advanceable by anyone', () => {
  const id = bonusForRed();
  const cur = applyDead(id, { isBonus: true }).session;
  assert.equal(cur.buzz_state.dead, true);
  for (const p of ['a', 'b', 'c', 'd']) {
    const v = clientView(cur, { myPlayerId: p, isBonus: true });
    assert.equal(v.canAdvance, true, `${p} may press next`);
    assert.equal(v.canAnswerBonus, false, 'the window has closed');
  }
});

test('an unowned bonus is never left for the room to stare at', () => {
  // Nobody won the tossup, so no team owns the bonus. The advance path steps
  // over it; if one is ever reached anyway it must not be a question that every
  // player is locked out of.
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const next = applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true }).session;
  for (const p of ['a', 'b', 'c', 'd']) {
    const v = clientView(next, { myPlayerId: p, isBonus: true });
    assert.equal(v.canAnswerBonus, false);
    assert.equal(v.dead, true);
    assert.equal(v.canAdvance, true);
  }
});

test('a player with no team owns the bonus they won, in a room that has teams', () => {
  // TeamPanel lists unassigned players under "No Team", so this is an ordinary
  // room state, not a corrupt one. The tossup is won for nobody's team, so the
  // bonus is the player's — reading it as a team bonus with no team locked the
  // winner out of their own bonus and let no one else have it either.
  const teams = [{ name: 'Red', captain_id: 'a' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'loner'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : '' }));

  const won = answer(s.id, 'loner', 'correct', { team: '' });
  assert.equal(clientView(won, { myPlayerId: 'loner' }).canAdvance, true,
    'they may advance the tossup they just won');

  const next = applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true }).session;
  assert.equal(clientView(next, { myPlayerId: 'loner', isBonus: true }).canAnswerBonus, true);
  for (const p of ['a', 'b']) {
    assert.equal(clientView(next, { myPlayerId: p, isBonus: true }).canAnswerBonus, false,
      `${p} did not win it`);
  }
  assert.equal(
    applyAnswer(s.id, { playerId: 'a', displayName: 'A', team: 'Red', result: 'correct', type: 'BONUS' }).rejected,
    'this bonus belongs to another team',
  );
});

test('a free-for-all bonus belongs to the one player who won the tossup', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  answer(s.id, 'a', 'correct');
  const next = applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true }).session;

  assert.equal(clientView(next, { myPlayerId: 'a', isBonus: true }).canAnswerBonus, true);
  for (const p of ['b', 'c']) {
    assert.equal(clientView(next, { myPlayerId: p, isBonus: true }).canAnswerBonus, false);
  }
  const outcome = applyAnswer(s.id, {
    playerId: 'b', displayName: 'B', team: '', result: 'correct', type: 'BONUS',
  });
  assert.equal(outcome.rejected, 'this bonus belongs to another team');
});

// ── Softlocks ───────────────────────────────────────────────────────────────

test('a buzz nobody answers is released, and the room reopens', () => {
  const s = makeSession();
  buzz(s.id, { player: 'a', at: Date.now() - STALE_BUZZ_MS - 1000 });

  const locked = clientView(getEntity('GameSession', s.id), { myPlayerId: 'b' });
  assert.equal(locked.canBuzz, false, 'locked out while the buzz is held');

  const released = applyStaleBuzzRelease(s.id).session;
  assert.equal(released.buzz_state.buzzed_player_id, null);
  const after = clientView(released, { myPlayerId: 'b' });
  assert.equal(after.canBuzz, true, 'the question reopens for everyone else');
  assert.equal(released.buzz_state.negged_players.includes('a'), true);
});

test('a fresh buzz is not released', () => {
  const s = makeSession();
  buzz(s.id, { player: 'a', at: Date.now() });
  const outcome = applyStaleBuzzRelease(s.id);
  assert.equal(outcome.patch, null);
  assert.equal(getEntity('GameSession', s.id).buzz_state.buzzed_player_id, 'a');
});

test('releasing a stale buzz is idempotent and never overrides a real answer', () => {
  const s = makeSession();
  buzz(s.id, { player: 'a', at: Date.now() - STALE_BUZZ_MS - 1000 });
  applyStaleBuzzRelease(s.id);
  const second = applyStaleBuzzRelease(s.id);
  assert.equal(second.patch, null, 'a second report does nothing');

  const t = makeSession();
  buzz(t.id, { player: 'a', at: Date.now() - STALE_BUZZ_MS - 1000 });
  answer(t.id, 'a', 'correct');
  const late = applyStaleBuzzRelease(t.id);
  assert.equal(late.patch, null);
  assert.equal(getEntity('GameSession', t.id).buzz_state.result, 'correct');
});

test('a dead question is advanceable by every player, always', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c', 'd'] });
  const cur = applyDead(s.id).session;
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: id }).canAdvance, true, `${id} must be able to advance`);
  }
});

test('a dead bonus is advanceable by everyone', () => {
  const s = makeSession();
  const cur = applyDead(s.id, { isBonus: true }).session;
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: id, isBonus: true }).canAdvance, true);
  }
});

test('the room can still advance when the winner and the host have both left', () => {
  const s = makeSession({ playerIds: ['host', 'winner', 'c', 'd'] });
  const withHost = getEntity('GameSession', s.id);
  withHost.host_id = 'host';
  answer(s.id, 'winner', 'correct');

  // Both leave (the leave route drops them from the roster and hands over the
  // room; test the harsher case where the handover has not been seen yet).
  const cur = getEntity('GameSession', s.id);
  cur.players = cur.players.filter(p => p.user_id !== 'host' && p.user_id !== 'winner');
  for (const id of ['c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: id }).canAdvance, true,
      `${id} must be able to advance after the winner and host left`);
  }
});

test('a bonus owned by a player who left does not strand the room', () => {
  const s = makeSession({ playerIds: ['owner', 'b', 'c'] });
  answer(s.id, 'owner', 'correct');           // owner earns the bonus
  applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true });
  const cur = getEntity('GameSession', s.id);
  cur.players = cur.players.filter(p => p.user_id !== 'owner');
  for (const id of ['b', 'c']) {
    assert.equal(clientView(cur, { myPlayerId: id, isBonus: true }).canAdvance, true);
  }
});

test('advancing clears the buzz state so the next question starts open', () => {
  const s = makeSession();
  answer(s.id, 'a', 'wrong', { format: 'Multiple Choice' });
  answer(s.id, 'b', 'wrong', { format: 'Multiple Choice' });
  const next = applyAdvance(s.id, { nextIndex: 1 }).session;
  assert.equal(next.buzz_state.dead, undefined);
  assert.equal(next.buzz_state.wrong_count, undefined);
  assert.equal(next.buzz_state.pending_buzz, undefined);
  const v = clientView(next, { myPlayerId: 'a', questionFormat: 'Multiple Choice' });
  assert.equal(v.canBuzz, true, 'everyone, including the previous neggers, may buzz again');
  assert.equal(v.revealsAnswer, false);
});

test('a bonus carried onto the next question keeps its owner and nobody else', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });
  answer(s.id, 'a', 'correct');
  const next = applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true }).session;
  assert.equal(next.buzz_state.bonus_for_player_id, 'a');
  assert.equal(clientView(next, { myPlayerId: 'b', isBonus: true }).canAnswerBonus, false);
  assert.equal(clientView(next, { myPlayerId: 'a', isBonus: true }).canAnswerBonus, true);
});

test('a provisional lock never outlives its question', () => {
  const s = makeSession();
  const live = getEntity('GameSession', s.id);
  live.buzz_state = { ...live.buzz_state, pending_buzz: { player_id: 'a', display_name: 'A' } };
  assert.equal(clientView(live, { myPlayerId: 'b' }).lockedByOther, true);

  const dead = applyDead(s.id).session;
  assert.equal(dead.buzz_state.pending_buzz, null);
  assert.equal(clientView(dead, { myPlayerId: 'b' }).lockedByOther, false);
});

test('starting a match clears anything left from the previous one', () => {
  const s = makeSession();
  answer(s.id, 'a', 'wrong');
  const started = applyStart(s.id).session;
  assert.equal(started.current_question_index, 0);
  assert.equal(started.buzz_state.wrong_count, undefined);
  assert.equal(clientView(started, { myPlayerId: 'a' }).canBuzz, true);
});

test('boss-ups reopen for everyone: no bonus ownership is carried', () => {
  // A boss-up reaches the server as a tossup, so a correct answer awards the
  // bonus fields — but the client never advances onto a BONUS question in a
  // boss-up game, so no one is ever locked out of the next one.
  const s = makeSession({ settings: { boss_ups: true }, playerIds: ['a', 'b'] });
  answer(s.id, 'a', 'correct', { type: 'TOSSUP' });
  const next = applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: false }).session;
  for (const id of ['a', 'b']) {
    assert.equal(clientView(next, { myPlayerId: id }).canBuzz, true, `${id} may buzz the next boss-up`);
  }
});

// A room must never reach a state where nobody can do anything. Rather than
// enumerate the ways that could happen, walk random sequences of every event a
// match can produce and assert the invariant after each one.
test('no reachable state leaves every player unable to act', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let run = 0; run < 300; run++) {
    const useTeams = rand() < 0.5;
    const ids = ['a', 'b', 'c', 'd'];
    const teams = useTeams
      ? [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }]
      : [];
    const s = makeSession({ teams, playerIds: ids });
    if (useTeams) {
      const live = getEntity('GameSession', s.id);
      live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));
    }
    getEntity('GameSession', s.id).host_id = 'a';
    const format = pick(['Multiple Choice', 'Short Answer']);
    const isBonus = false;
    let roster = [...ids];

    for (let step = 0; step < 8; step++) {
      const cur = getEntity('GameSession', s.id);
      const views = roster.map(id => ({ id, v: clientView(cur, { myPlayerId: id, questionFormat: format, isBonus }) }));

      if (roster.length > 0) {
        assert.ok(
          views.some(({ v }) => v.canBuzz || v.canAdvance),
          `run ${run} step ${step}: nobody could buzz or advance\n${JSON.stringify(cur.buzz_state)}`,
        );

        // A team's right to buzz belongs to the team, not to one nominated
        // player: if the question is open to a team at all, whoever of them is
        // still in the room can take it. The weaker invariant above cannot see
        // this — the host can always advance, which hides a room where a whole
        // team has gone quiet.
        if (useTeams) {
          const bs = cur.buzz_state || {};
          const open = !bs.dead && bs.result !== 'correct' && !bs.buzzed_player_id
            && !bs.pending_buzz && !bs.bonus_for_team;
          if (open) {
            for (const team of ['Red', 'Blue']) {
              const present = views.filter(({ id }) =>
                cur.players.find(p => p.user_id === id)?.team === team);
              if (present.length === 0) continue;
              if ((bs.negged_teams || []).includes(team)) continue;
              assert.ok(
                present.some(({ v }) => v.canBuzz),
                `run ${run} step ${step}: ${team} is open but no present member could buzz` +
                `\n${JSON.stringify(bs)}`,
              );
            }
          }
        }
      }

      const action = pick(['answer', 'answer', 'answer', 'dead', 'stale', 'leave']);
      const eligible = views.filter(({ v }) => v.canBuzz).map(({ id }) => id);

      if (action === 'answer' && eligible.length > 0) {
        const who = pick(eligible);
        const team = cur.players.find(p => p.user_id === who)?.team || '';
        buzz(s.id, { player: who, team });
        answer(s.id, who, pick(['correct', 'wrong', 'interrupt_wrong', 'timeout']), { team, format });
      } else if (action === 'dead') {
        applyDead(s.id);
      } else if (action === 'stale' && eligible.length > 0) {
        const who = pick(eligible);
        buzz(s.id, { player: who, at: Date.now() - STALE_BUZZ_MS - 1000 });
        applyStaleBuzzRelease(s.id, { questionFormat: format });
      } else if (action === 'leave' && roster.length > 2) {
        const gone = pick(roster);
        roster = roster.filter(id => id !== gone);
        const live = getEntity('GameSession', s.id);
        live.players = live.players.filter(p => p.user_id !== gone);
        if (live.host_id === gone) live.host_id = live.players[0].user_id; // the leave route hands over
      }
    }
  }
});

// The bonus twin of the softlock walk above. A bonus is the narrowest state in
// the match — exactly one team may act on it — so it is where "nobody can do
// anything" is easiest to reach. Rather than trust that the three ways a room
// can be arranged (teams, free-for-all, teams with unassigned players) all
// resolve ownership the same way, enumerate them against every way the owner
// can go missing.
test('no bonus state leaves the room with nothing to do', () => {
  const arrangements = [
    { name: 'teams', teams: [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }],
      teamOf: { a: 'Red', b: 'Red', c: 'Blue', d: 'Blue' } },
    { name: 'free-for-all', teams: [], teamOf: {} },
    { name: 'teams with an unassigned player', teams: [{ name: 'Red', captain_id: 'a' }],
      teamOf: { a: 'Red', b: 'Red' } },
  ];

  for (const arrangement of arrangements) {
    for (const winner of ['a', 'd']) {
      for (const leaving of [[], [winner], ['a', 'b'], ['a', 'b', 'c', 'd'].filter(id => id !== 'c')]) {
        for (const outcome of [null, 'wrong', 'correct']) {
          const s = makeSession({ teams: arrangement.teams, playerIds: ['a', 'b', 'c', 'd'] });
          const live = getEntity('GameSession', s.id);
          live.players = live.players.map(p => ({ ...p, team: arrangement.teamOf[p.user_id] || '' }));
          live.host_id = 'a';

          const winnerTeam = arrangement.teamOf[winner] || '';
          answer(s.id, winner, 'correct', { team: winnerTeam });
          applyAdvance(s.id, { nextIndex: 1, keepBonusOwner: true });
          if (outcome) answer(s.id, winner, outcome, { team: winnerTeam, type: 'BONUS' });

          const cur = getEntity('GameSession', s.id);
          cur.players = cur.players.filter(p => !leaving.includes(p.user_id));
          // The leave route always hands the room over to someone still here.
          if (leaving.includes(cur.host_id) && cur.players.length > 0) cur.host_id = cur.players[0].user_id;

          const roster = cur.players.map(p => p.user_id);
          if (roster.length === 0) continue;
          const views = roster.map(id => ({ id, v: clientView(cur, { myPlayerId: id, isBonus: true }) }));

          const where = `${arrangement.name}, won by ${winner}, ${outcome || 'unanswered'}, ` +
            `after ${leaving.length ? leaving.join('+') + ' left' : 'nobody left'}`;
          assert.ok(
            views.some(({ v }) => v.canAnswerBonus || v.canAdvance),
            `${where}: nobody could answer or advance\n${JSON.stringify(cur.buzz_state)}`,
          );
          // A bonus its own team answered is theirs to advance, like the tossup
          // before it. But a DEAD one — the window gone, or the team gone — is
          // over for the whole room, so every player must be able to move it on
          // without waiting on anybody.
          for (const { id, v } of views) {
            if (!v.dead) continue;
            assert.equal(v.canAdvance, true, `${where}: ${id} could not advance a dead bonus`);
            assert.equal(v.canAnswerBonus, false, `${where}: ${id} could still answer a dead bonus`);
            assert.equal(v.revealsAnswer, true, `${where}: the answer stayed hidden after the bonus died`);
          }
          // Nobody left who may answer it ⇒ it is dead. This is the rule that
          // keeps a room from staring at a question none of them may touch.
          if (views.every(({ v }) => !v.canAnswerBonus) && !cur.buzz_state.result) {
            for (const { id, v } of views) {
              assert.equal(v.dead, true, `${where}: ${id} sees an unanswerable bonus as still live`);
            }
          }
        }
      }
    }
  }
});

// ── Who may move the match on ───────────────────────────────────────────────
//
// Advancing used to be a host power on top of everything else, which made two
// things possible that shouldn't be: skipping a question that was still being
// played, and taking the next question away from the team that had just won the
// tossup — the bonus is theirs, so getting to it is theirs.

/** Two teams: Red = a, b · Blue = c, d. `a` hosts. */
function twoTeams() {
  const teams = [{ name: 'Red', captain_id: 'a' }, { name: 'Blue', captain_id: 'c' }];
  const s = makeSession({ teams, playerIds: ['a', 'b', 'c', 'd'] });
  const live = getEntity('GameSession', s.id);
  live.players = live.players.map(p => ({ ...p, team: ['a', 'b'].includes(p.user_id) ? 'Red' : 'Blue' }));
  live.host_id = 'a';
  return s.id;
}

test('a won tossup is advanced by the winning team and nobody else', () => {
  const id = twoTeams();
  const cur = answer(id, 'd', 'correct', { team: 'Blue' });   // Blue wins it

  for (const p of ['c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: p }).canAdvance, true,
      `${p} won it, and the bonus that follows is theirs`);
  }
  for (const p of ['a', 'b']) {
    assert.equal(clientView(cur, { myPlayerId: p }).canAdvance, false,
      `${p} lost it — including A, who is the host`);
  }
});

test('the host cannot skip a question that is still being played', () => {
  const id = twoTeams();
  for (const p of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(getEntity('GameSession', id), { myPlayerId: p }).canAdvance, false,
      `${p} must not be able to skip a live question`);
  }
  // …and a wrong answer leaves it live for the others, so still nobody.
  const cur = answer(id, 'a', 'wrong', { team: 'Red' });
  for (const p of ['a', 'b', 'c', 'd']) {
    assert.equal(clientView(cur, { myPlayerId: p }).canAdvance, false);
  }
  assert.equal(clientView(cur, { myPlayerId: 'c' }).canBuzz, true, 'Blue can still take it');
});

test('a finished bonus is advanced by everyone, whichever way it went', () => {
  for (const outcome of ['correct', 'wrong']) {
    const id = bonusForRed();
    applyAnswer(id, {
      playerId: 'a', displayName: 'A', team: 'Red', result: outcome, type: 'BONUS',
    });
    const cur = getEntity('GameSession', id);
    for (const p of ['a', 'b', 'c', 'd']) {
      assert.equal(clientView(cur, { myPlayerId: p, isBonus: true }).canAdvance, true,
        `${p} may move on from a ${outcome} bonus`);
    }
  }
});

test('a question nobody left in the room can answer is dead', () => {
  // Red misses it and Blue walks out. The `teams` array still lists Blue, so
  // counting team rows read the question as live for a team that had gone —
  // and with no host override, nobody could buzz it or move past it.
  const id = twoTeams();
  answer(id, 'a', 'wrong', { team: 'Red' });
  const cur = getEntity('GameSession', id);
  cur.players = cur.players.filter(p => p.team !== 'Blue');

  for (const p of ['a', 'b']) {
    const v = clientView(cur, { myPlayerId: p });
    assert.equal(v.dead, true, `${p} sees a question no one present may answer as dead`);
    assert.equal(v.canAdvance, true, `${p} may move the room on`);
  }
});

test('an untimed room can always move on from a question nobody buzzed', () => {
  // No clock to kill it and no host override — without an escape hatch the room
  // would stop at the first question everyone sat out.
  const s = makeSession({ settings: { timed: false }, playerIds: ['a', 'b'] });
  for (const p of ['a', 'b']) {
    assert.equal(clientView(getEntity('GameSession', s.id), { myPlayerId: p }).canAdvance, true);
  }
});

// ── The question log ────────────────────────────────────────────────────────

test('a question that dies unanswered is logged, at zero', () => {
  const s = makeSession();
  const cur = applyDead(s.id).session;
  const entry = cur.question_results.at(-1);
  assert.equal(entry.kind, 'dead');
  assert.equal(entry.points, 0);
  assert.equal(entry.question_index, 0);
  assert.equal(entry.player, '', 'nobody answered it');
});

test('every client reporting a dead question logs it once', () => {
  const s = makeSession();
  applyDead(s.id);
  applyDead(s.id);
  applyDead(s.id);
  assert.equal(getEntity('GameSession', s.id).question_results.length, 1);
});

test('a question that died on its wrong-answer limit is not logged twice', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });
  answer(s.id, 'a', 'wrong');
  answer(s.id, 'b', 'wrong');            // all_answered ⇒ dead
  applyDead(s.id);                       // a client's timer fires afterwards
  const results = getEntity('GameSession', s.id).question_results;
  assert.equal(results.length, 2, 'the two wrong answers, and no extra dead row');
  assert.equal(results.every(r => r.kind !== 'dead'), true);
});

test('a question the room stepped over still appears in the log', () => {
  const s = makeSession();
  const next = applyAdvance(s.id, { nextIndex: 1, currentType: 'TOSSUP' }).session;
  const entry = next.question_results.at(-1);
  assert.equal(entry.kind, 'dead');
  assert.equal(entry.points, 0);
  assert.equal(entry.question_index, 0);
  // …and the one it moved onto is not logged until it too is played.
  assert.equal(next.question_results.length, 1);
});

test('advancing past an answered question adds nothing', () => {
  const s = makeSession();
  answer(s.id, 'a', 'correct');
  const next = applyAdvance(s.id, { nextIndex: 1, currentType: 'TOSSUP' }).session;
  assert.equal(next.question_results.length, 1, 'just the correct answer');
});

// ── Pause ───────────────────────────────────────────────────────────────────

test('pausing freezes the reading and resuming picks up where it stopped', async () => {
  const s = makeSession();
  const startedAt = getEntity('GameSession', s.id).buzz_state.reading_started_at;

  applyPause(s.id, { paused: true });
  const paused = getEntity('GameSession', s.id).buzz_state;
  assert.ok(paused.paused_at, 'the instant it stopped is recorded');
  assert.equal(paused.reading_started_at, startedAt, 'and the read is untouched while stopped');

  await new Promise(r => setTimeout(r, 30));
  applyPause(s.id, { paused: false });
  const resumed = getEntity('GameSession', s.id).buzz_state;
  assert.equal(resumed.paused_at, null);
  // Every client derives its word from `now - reading_started_at`, so the start
  // moves forward by the paused interval rather than the reading jumping ahead.
  assert.ok(resumed.reading_started_at >= startedAt + 25,
    `reading start did not absorb the pause (${resumed.reading_started_at - startedAt}ms)`);
});

test('pausing twice, or resuming an unpaused match, does nothing', () => {
  const s = makeSession();
  applyPause(s.id, { paused: true });
  const first = getEntity('GameSession', s.id).buzz_state.paused_at;
  assert.equal(applyPause(s.id, { paused: true }).patch, null);
  assert.equal(getEntity('GameSession', s.id).buzz_state.paused_at, first);

  applyPause(s.id, { paused: false });
  assert.equal(applyPause(s.id, { paused: false }).patch, null);
});

test('a pause does not let the watchdog neg the player holding the buzz', async () => {
  const s = makeSession();
  buzz(s.id, { player: 'a', at: Date.now() });
  applyPause(s.id, { paused: true });

  // Long enough that the hold would be stale if the pause were not counted.
  const later = Date.now() + STALE_BUZZ_MS + 5000;
  assert.equal(applyStaleBuzzRelease(s.id, { now: later }).patch, null,
    'a stopped match is not a frozen tab');
  assert.equal(getEntity('GameSession', s.id).buzz_state.buzzed_player_id, 'a');

  await new Promise(r => setTimeout(r, 30));
  applyPause(s.id, { paused: false });
  const bs = getEntity('GameSession', s.id).buzz_state;
  assert.ok(bs.buzzed_at >= Date.now() - 5,
    'the answer window resumes rather than having quietly run out during the pause');
});

test('a finished question cannot be paused', () => {
  const s = makeSession();
  answer(s.id, 'a', 'correct');
  assert.equal(applyPause(s.id, { paused: true }).patch, null,
    'a pause held across the advance would freeze the next question');
});

// ── Ending a marathon ───────────────────────────────────────────────────────
//
// A marathon has no last question, so it needs a way to be stopped — and the
// obvious one, a host button, is the unilateral power the rest of the match
// controls were deliberately stripped of. So the room agrees to it instead.

const endRequest = (id, player) => applyEndRequest(id, {
  playerId: player, displayName: player.toUpperCase(), currentType: 'TOSSUP',
});
const endVote = (id, player, accept) => applyEndVote(id, {
  playerId: player, displayName: player.toUpperCase(), accept, currentType: 'TOSSUP',
});

test('a player alone in the room ends the marathon outright', () => {
  const s = makeSession({ playerIds: ['a'] });
  const cur = endRequest(s.id, 'a').session;
  assert.equal(cur.status, 'finished', 'there is nobody to ask');
  assert.equal(cur.end_vote, null);
  // The question they were on is still a question that was played.
  assert.equal(cur.question_results.at(-1).kind, 'dead');
});

test('with others in the room it asks rather than ends', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  const cur = endRequest(s.id, 'a').session;
  assert.equal(cur.status, 'active', 'the game does not stop on one player saying so');
  assert.deepEqual(cur.end_vote.accepted, ['a'], 'asking is agreeing');
  assert.equal(cur.end_vote.requested_by, 'a');
});

test('the marathon ends only once everyone has accepted', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  endRequest(s.id, 'a');

  const afterB = endVote(s.id, 'b', true).session;
  assert.equal(afterB.status, 'active', 'C has not answered yet');
  assert.deepEqual(afterB.end_vote.accepted, ['a', 'b']);

  const afterC = endVote(s.id, 'c', true).session;
  assert.equal(afterC.status, 'finished');
  assert.equal(afterC.end_vote, null);
});

test('one decline keeps the game going', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  endRequest(s.id, 'a');
  endVote(s.id, 'b', true);
  const declined = endVote(s.id, 'c', false).session;
  assert.equal(declined.status, 'active');
  assert.equal(declined.end_vote.declined_by, 'C', 'the room is told who, not left guessing');

  // …and it can be dismissed by anyone, since it is over either way.
  const cleared = applyEndVoteClear(s.id, { playerId: 'b' }).session;
  assert.equal(cleared.end_vote, null);
});

test('accepting twice does not double-count, and asking twice keeps the tally', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  endRequest(s.id, 'a');
  endVote(s.id, 'b', true);
  endVote(s.id, 'b', true);
  assert.deepEqual(getEntity('GameSession', s.id).end_vote.accepted, ['a', 'b']);

  endRequest(s.id, 'a');   // pressed again
  assert.deepEqual(getEntity('GameSession', s.id).end_vote.accepted, ['a', 'b'],
    'a second press must not wipe the accepts already in');
});

test('only the requester may withdraw, and a lapsed request clears for anyone', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });
  endRequest(s.id, 'a');
  assert.equal(applyEndVoteClear(s.id, { playerId: 'b' }).patch, null,
    'B cannot silently cancel a live request — they decline it');
  assert.equal(applyEndVoteClear(s.id, { playerId: 'a' }).session.end_vote, null);

  // A request nobody answers has to go away on its own.
  endRequest(s.id, 'a');
  const live = getEntity('GameSession', s.id);
  live.end_vote = { ...live.end_vote, requested_at: Date.now() - END_VOTE_MS - 1000 };
  assert.equal(applyEndVoteClear(s.id, { playerId: 'b' }).session.end_vote, null,
    'any client may report the lapse');
});

test('a request is not stranded by the player it was waiting on leaving', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  endRequest(s.id, 'a');
  endVote(s.id, 'b', true);

  const live = getEntity('GameSession', s.id);
  live.players = live.players.filter(p => p.user_id !== 'c');   // the hold-out leaves
  const settled = resolveEndVoteAfterLeave(s.id);
  assert.equal(settled.session.status, 'finished',
    'everyone still here had agreed, so it ends rather than waiting on someone who has gone');
});

test('a request goes with the player who made it', () => {
  const s = makeSession({ playerIds: ['a', 'b', 'c'] });
  endRequest(s.id, 'a');
  const live = getEntity('GameSession', s.id);
  live.players = live.players.filter(p => p.user_id !== 'a');
  const settled = resolveEndVoteAfterLeave(s.id);
  assert.equal(settled.session.end_vote, null);
  assert.equal(settled.session.status, 'active', 'the rest carry on');
});

test('starting a new game clears a request left over from the last one', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });
  endRequest(s.id, 'a');
  assert.equal(applyStart(s.id).session.end_vote, null);
});

// ── Reading position across a buzz ──────────────────────────────────────────

test('a reopened tossup resumes from the word it was frozen on', async () => {
  const s = makeSession();
  const startedAt = getEntity('GameSession', s.id).buzz_state.reading_started_at;
  buzz(s.id, { player: 'a', at: Date.now() });
  await new Promise(r => setTimeout(r, 30));

  // A gets it wrong, so the question reopens for everyone else.
  const cur = answer(s.id, 'a', 'wrong');
  assert.ok(cur.buzz_state.reading_started_at >= startedAt + 25,
    'the time A spent holding the buzz is added to the reading start, so the ' +
    'other teams pick up on the word it stopped at rather than several ahead');
});

test('every player answering wrong kills the question even under the limit', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });   // 2 players, short answer limit 3
  answer(s.id, 'a', 'wrong');
  const cur = answer(s.id, 'b', 'wrong');
  assert.equal(cur.buzz_state.dead, true);
  assert.equal(cur.buzz_state.dead_reason, 'all_answered');
  assert.equal(clientView(cur, { myPlayerId: 'a' }).canAdvance, true);
});
