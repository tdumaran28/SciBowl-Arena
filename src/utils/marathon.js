// Infinite marathon question sampling.
//
// Marathon games never pre-build a finite queue: question k is drawn on demand
// from the combined question pool, weighted by the user's subject percentages.
// The draw is DETERMINISTIC in (seed, k) — given the same rounds, filters, and
// seed, every client materializes the identical question sequence. Multiplayer
// marathon relies on this: the session stores only { seed, round_ids,
// subject_freq, ... } and each client derives the questions locally.

// ── Seeded PRNG ──────────────────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

// ── Pool building ────────────────────────────────────────────────────────────

function matchesRoundFilter(round, roundFilter) {
  if (!roundFilter || roundFilter === 'all') return true;
  const title = (round.title || '').toLowerCase();
  return roundFilter === 'RR'
    ? /\b(rr|round\s*robin)\b/.test(title)
    : /\b(de|double\s*elim)/.test(title);
}

/**
 * Build per-subject question pools from the selected rounds.
 * Deterministic: rounds are sorted by id so every client gets identical pools.
 *
 * subjectFreq maps subject → weight percent (0–100). Subjects at 0 (or with no
 * questions) are excluded; the rest are sampled proportionally to their weight
 * (weights are normalized, so they don't need to sum to 100).
 *
 * Returns { subjects, pools, weights, totalWeight, poolSize, roundIds } —
 * subjects/weights are parallel arrays. `roundIds` is the resolved packet list
 * (what "all" actually expanded to): a multiplayer room stores this rather
 * than an empty "all", because libraries differ per player once private
 * packets exist, and every client must sample from the identical pool.
 */
export function buildMarathonPools(rounds, {
  roundIds = [],
  roundFilter = 'all',
  questionTypes = ['TOSSUP', 'BONUS'],
  subjectFreq = {},
} = {}) {
  // Marathon draws from PUBLIC packets only, and this filter is applied here
  // rather than at each call site so the rule cannot be bypassed.
  //
  // The reason is determinism, not secrecy: a marathon materializes question k
  // from (seed, k) against the pool, and each client builds its own pool. If
  // private packets could enter, two players' pools would differ and the same
  // index would give them different questions. Everyone must share one bank.
  // Private packets are still fully playable — in round practice.
  const publicRounds = rounds.filter(r => r?.is_public !== false);

  const selected = (roundIds.length > 0
    ? publicRounds.filter(r => roundIds.includes(r.id))
    : publicRounds
  ).filter(r => matchesRoundFilter(r, roundFilter));
  selected.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const byId = {};
  for (const r of selected) {
    for (const q of r.questions || []) {
      if (!questionTypes.includes(q.type)) continue;
      const subject = q.subject || 'General Science';
      if ((subjectFreq[subject] ?? 0) <= 0) continue;
      (byId[subject] ||= []).push({ ...q, question_set: q.question_set || r.title });
    }
  }

  const subjects = Object.keys(byId).sort();
  const pools = subjects.map(s => byId[s]);
  const weights = subjects.map(s => subjectFreq[s] ?? 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const poolSize = pools.reduce((a, p) => a + p.length, 0);
  return { subjects, pools, weights, totalWeight, poolSize, roundIds: selected.map(r => r.id) };
}

/**
 * Effective share (0–1) of questions each subject will receive, given raw
 * 0–100 weights — i.e. the weights normalized over subjects with weight > 0.
 */
export function effectiveShares(subjectFreq) {
  const entries = Object.entries(subjectFreq);
  const total = entries.reduce((a, [, w]) => a + (w > 0 ? w : 0), 0);
  return Object.fromEntries(entries.map(([s, w]) => [s, total > 0 && w > 0 ? w / total : 0]));
}

// ── Deterministic draws ──────────────────────────────────────────────────────

/**
 * The k-th marathon question for a given seed. Weighted subject pick, then a
 * uniform pick inside that subject's pool (sampling with replacement — the
 * marathon never runs out). Returns null when every pool is empty.
 */
export function marathonQuestionAt(poolData, seed, k) {
  const { pools, weights, totalWeight } = poolData;
  if (!pools?.length || totalWeight <= 0) return null;
  // Fresh generator per index so any client can jump straight to question k
  const rng = mulberry32((seed ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0);
  let r = rng() * totalWeight;
  let si = 0;
  for (; si < pools.length - 1; si++) {
    r -= weights[si];
    if (r < 0) break;
  }
  const pool = pools[si];
  if (!pool?.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/** Materialize questions [0..count) — used for post-game review. */
export function marathonQuestions(poolData, seed, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const q = marathonQuestionAt(poolData, seed, k);
    if (!q) break;
    out.push(q);
  }
  return out;
}
