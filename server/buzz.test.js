// Buzz arbitration tests: node --test server/buzz.test.js
//
// Two properties matter here and they pull against each other: every other
// screen must lock as close to instantly as possible, while the buzz itself is
// still awarded to whoever actually pressed first rather than to whoever has
// the shortest network path. The first is the provisional lock; the second is
// the arbitration window. These tests hold both.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scibowl-buzz-'));
process.chdir(tmp);

const { createEntity, getEntity } = await import('./db.js');
const { claimBuzz, cancelWindow, ARBITRATION_WINDOW_MS } = await import('./buzz.js');
const { applyDead, applyAnswer } = await import('./match.js');

// Capture what would go out over the WebSocket (server.js installs the real one).
const frames = [];
globalThis.__scibowlBroadcast = (msg) => frames.push(msg);

function makeSession() {
  frames.length = 0;
  return createEntity('GameSession', {
    mode: 'multiplayer',
    status: 'active',
    players: ['a', 'b', 'c'].map(id => ({ user_id: id, display_name: id.toUpperCase(), score: 0, team: '' })),
    teams: [],
    settings: {},
    current_question_index: 0,
    buzz_state: { reading_started_at: Date.now() - 3000 },
    question_results: [],
  });
}

test('the first claim locks every other screen before arbitration finishes', () => {
  const s = makeSession();
  claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });

  // Synchronously — no awaiting the window.
  const pending = getEntity('GameSession', s.id).buzz_state.pending_buzz;
  assert.equal(pending.player_id, 'a');
  assert.equal(frames.length, 1, 'the lock is pushed immediately, not at window close');
  assert.equal(frames[0].patch.buzz_state.pending_buzz.player_id, 'a');

  cancelWindow(s.id);
});

test('the earliest press wins, not the first request to arrive', async () => {
  const s = makeSession();
  const now = Date.now();
  // B reaches the server first but pressed 40ms later than A.
  const bFirst = claimBuzz(s.id, { playerId: 'b', team: '', displayName: 'B', buzzedAt: now - 10 });
  const aSecond = claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: now - 50 });

  const [rb, ra] = await Promise.all([bFirst, aSecond]);
  assert.equal(ra.winnerId, 'a');
  assert.equal(rb.winnerId, 'a', 'both callers see the same verdict');
  assert.equal(ra.marginMs, 40);
  assert.equal(getEntity('GameSession', s.id).buzz_state.buzzed_player_id, 'a');
  assert.equal(getEntity('GameSession', s.id).buzz_state.pending_buzz, null,
    'the provisional lock is replaced by the arbitrated one');
});

test('the settled lock is broadcast when the window closes, not on a response', async () => {
  const s = makeSession();
  await claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });
  const settled = frames.filter(f => f.patch?.buzz_state?.buzzed_player_id === 'a');
  assert.equal(settled.length, 1);
});

test('a question that resolves mid-window awards nobody', async () => {
  const s = makeSession();
  const claim = claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });
  applyDead(s.id);                       // the tossup timer fires while the window is open
  const outcome = await claim;
  assert.equal(outcome.winnerId, null,
    'nobody may be left holding a buzz the server never granted');
  assert.equal(getEntity('GameSession', s.id).buzz_state.buzzed_player_id, null);
  assert.equal(getEntity('GameSession', s.id).buzz_state.pending_buzz, null,
    'and the provisional lock is cleared rather than left on screen');
});

// A tossup someone gets WRONG is not over — it reopens for the other teams. But
// the wrong answer leaves its result on the buzz state while it does, and both
// the window and the route used to read "has a result" as "is finished". The
// next team pressed the buzzer, the claim was rejected, and their answer box
// vanished a moment after it appeared.
test('the next team may buzz after a neg, and the window awards it', async () => {
  const s = makeSession();
  // A buzzes, interrupts, and gets it wrong.
  await claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });
  applyAnswer(s.id, {
    playerId: 'a', displayName: 'A', team: '', result: 'interrupt_wrong',
    type: 'TOSSUP', interrupted: true, questionFormat: 'Short Answer',
  });
  const afterNeg = getEntity('GameSession', s.id).buzz_state;
  assert.equal(afterNeg.result, 'neg', 'the neg is on the record…');
  assert.equal(afterNeg.dead, false, '…but the question is still live');

  const outcome = await claimBuzz(s.id, {
    playerId: 'b', team: '', displayName: 'B', buzzedAt: Date.now(),
  });
  assert.equal(outcome.winnerId, 'b', 'B must actually be given the buzz');

  const bs = getEntity('GameSession', s.id).buzz_state;
  assert.equal(bs.buzzed_player_id, 'b');
  assert.equal(bs.result, null,
    'the previous team’s miss is cleared, or every client reads the question as resolved');
  assert.equal(bs.negged_players.includes('a'), true, 'A stays locked out');
});

test('a buzz is refused once the question really is over', async () => {
  const s = makeSession();
  await claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });
  applyAnswer(s.id, {
    playerId: 'a', displayName: 'A', team: '', result: 'correct', type: 'TOSSUP',
  });
  const outcome = await claimBuzz(s.id, {
    playerId: 'b', team: '', displayName: 'B', buzzedAt: Date.now(),
  });
  assert.equal(outcome.winnerId, null);
  assert.equal(getEntity('GameSession', s.id).buzz_state.result, 'correct');
});

test('a buzz stamped before the question began is clamped, not trusted', async () => {
  const s = makeSession();
  const readingStart = getEntity('GameSession', s.id).buzz_state.reading_started_at;
  const [honest, cheat] = await Promise.all([
    claimBuzz(s.id, { playerId: 'b', team: '', displayName: 'B', buzzedAt: Date.now() - 100 }),
    claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: readingStart - 60_000 }),
  ]);
  const winner = getEntity('GameSession', s.id).buzz_state;
  assert.ok(winner.buzzed_at >= readingStart, 'clamped to the start of the reading');
  assert.equal(honest.winnerId, cheat.winnerId);
});

test('the arbitration window stays inside its documented budget', async () => {
  const s = makeSession();
  const started = Date.now();
  await claimBuzz(s.id, { playerId: 'a', team: '', displayName: 'A', buzzedAt: Date.now() });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= ARBITRATION_WINDOW_MS - 5, `resolved too early (${elapsed}ms)`);
  assert.ok(elapsed < ARBITRATION_WINDOW_MS + 120, `window overran (${elapsed}ms)`);
});
