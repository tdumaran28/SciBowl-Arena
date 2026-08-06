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
  applyAnswer, applyDead, applyAdvance, applyStart, applyStaleBuzzRelease,
  STALE_BUZZ_MS, SCORING,
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
  assert.equal(clientView(next, { myPlayerId: 'b', isBonus: true }).canBuzz, false);
  assert.equal(clientView(next, { myPlayerId: 'a', isBonus: true }).canBuzz, true);
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

test('every player answering wrong kills the question even under the limit', () => {
  const s = makeSession({ playerIds: ['a', 'b'] });   // 2 players, short answer limit 3
  answer(s.id, 'a', 'wrong');
  const cur = answer(s.id, 'b', 'wrong');
  assert.equal(cur.buzz_state.dead, true);
  assert.equal(cur.buzz_state.dead_reason, 'all_answered');
  assert.equal(clientView(cur, { myPlayerId: 'a' }).canAdvance, true);
});
