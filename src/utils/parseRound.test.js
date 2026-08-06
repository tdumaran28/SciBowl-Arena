// Question-rule tests: node --test src/utils/parseRound.test.js
//
// The rules that decide what gets played and how it is numbered. These are
// shared by solo and multiplayer, and in multiplayer every client derives its
// own copy of the list — so a disagreement here desynchronizes a room.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyQuestionRules, asBossUp, pairPositions, pointsFor, calculateScore, SCORING,
} from './parseRound.js';

/** A packet as parsed: numbered tossup/bonus pairs. */
function packet(pairs = 23) {
  const qs = [];
  for (let n = 1; n <= pairs; n++) {
    qs.push({ number: n, type: 'TOSSUP', subject: 'Biology', format: 'Short Answer', question_text: `T${n}`, answer: 'a' });
    qs.push({ number: n, type: 'BONUS', subject: 'Physics', format: 'Multiple Choice', question_text: `B${n}`, answer: 'a' });
  }
  return qs;
}

// ── Pair numbering ──────────────────────────────────────────────────────────

test('a 46-question packet is numbered as 23 pairs', () => {
  const { labels, totalPairs } = pairPositions(packet(23));
  assert.equal(totalPairs, 23, '23 pairs, not 46 questions');
  assert.deepEqual(labels.slice(0, 4), ['1.T', '1.B', '2.T', '2.B']);
  assert.equal(labels.at(-1), '23.B');
});

test('a boss-up is still numbered as the bonus it replaced', () => {
  const boss = applyQuestionRules(packet(23), { boss_ups: true });
  const { labels, totalPairs } = pairPositions(boss);
  assert.equal(totalPairs, 23);
  assert.deepEqual(labels.slice(0, 4), ['1.T', '1.B', '2.T', '2.B'],
    'rewriting the type must not renumber the packet');
});

test('numbering stays contiguous when a filter drops half a pair', () => {
  const p = packet(3);
  const filtered = [p[0], p[3], p[4]];           // T1, B2, T3
  assert.deepEqual(pairPositions(filtered).labels, ['1.T', '1.B', '2.T']);
});

test('skipping bonuses numbers the tossups straight through', () => {
  const { labels, totalPairs } = pairPositions(applyQuestionRules(packet(23), { skip_bonuses: true }));
  assert.equal(totalPairs, 23);
  assert.deepEqual(labels.slice(0, 3), ['1.T', '2.T', '3.T']);
});

test('a list that opens on a bonus still starts at 1', () => {
  const p = packet(2);
  assert.deepEqual(pairPositions([p[1], p[2]]).labels, ['1.B', '2.T']);
  assert.deepEqual(pairPositions([]).labels, []);
  assert.equal(pairPositions([]).totalPairs, 0);
});

// ── Boss-ups ────────────────────────────────────────────────────────────────

test('boss-ups turn a packet into one long stream of tossups', () => {
  const boss = applyQuestionRules(packet(23), { boss_ups: true });
  assert.equal(boss.length, 46, 'nothing is dropped — every bonus is still read');
  assert.deepEqual([...new Set(boss.map(q => q.type))], ['TOSSUP']);
  assert.equal(boss.every(q => q.question_text), true);
  // Which slot each one came from survives, for numbering and for the badge.
  assert.equal(boss[1].original_type, 'BONUS');
  assert.equal(boss[1].boss_up, true);
  assert.equal(boss[0].boss_up, undefined);
});

test('a boss-up stream repeats number+type, so position is the only identity', () => {
  // This is what broke the reader: it keyed "which question am I showing" on
  // number+type, and in a boss-up stream a pair shares both. Any consumer that
  // needs to tell one read from the next has to use the position.
  const boss = applyQuestionRules(packet(23), { boss_ups: true });
  const naive = new Set(boss.map(q => `${q.number}-${q.type}`));
  assert.equal(naive.size, 23, 'number+type collides across every pair');
  const byPosition = new Set(boss.map((q, i) => `${i}:${q.number}:${q.type}`));
  assert.equal(byPosition.size, 46, 'position separates every read');
});

test('boss-ups take precedence over skipping bonuses', () => {
  const boss = applyQuestionRules(packet(5), { boss_ups: true, skip_bonuses: true });
  assert.equal(boss.length, 10, 'there is nothing to skip once bonuses are boss-ups');
});

test('a subject filter applies before boss-ups', () => {
  const boss = applyQuestionRules(packet(5), { boss_ups: true, subjects: ['Physics'] });
  assert.equal(boss.length, 5, 'only the bonuses are Physics in this packet');
  assert.equal(boss.every(q => q.type === 'TOSSUP' && q.original_type === 'BONUS'), true);
});

test('asBossUp leaves tossups alone', () => {
  const t = { number: 1, type: 'TOSSUP' };
  assert.equal(asBossUp(t), t);
  assert.equal(asBossUp(null), null);
});

// ── Scoring of a boss-up ────────────────────────────────────────────────────

test('a boss-up scores as a tossup, not as a bonus', () => {
  const boss = asBossUp({ number: 1, type: 'BONUS' });
  assert.equal(pointsFor('correct', boss.type, {}), SCORING.TOSSUP_CORRECT);
  assert.equal(pointsFor('correct', boss.type, { interrupted: true, powers: true }), SCORING.TOSSUP_POWER);
  assert.equal(pointsFor('interrupt_wrong', boss.type, {}), SCORING.TOSSUP_INTERRUPT_WRONG,
    'negs apply — a boss-up is interruptible');
  assert.equal(
    calculateScore([{ result: 'correct', type: boss.type, interrupted: true }], { powers: true }),
    SCORING.TOSSUP_POWER,
  );
});
