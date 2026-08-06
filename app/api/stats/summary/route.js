import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import * as store from '@server/store';

// Aggregated dashboard stats, computed server-side over the whole database so
// counts never cap out at a client fetch limit.
//
// Everything here goes through the storage dispatcher. Reading `db.entities`
// directly — as the round counts used to — reads the local JSON store, which
// holds nothing but live game sessions once Supabase is configured: the
// dashboard reported a library of zero packets while the library was full.

// Packets carry their whole question array, and every signed-in dashboard polls
// this route every 60s, so the walk over them is memoized for a poll interval.
const ROUND_CACHE_MS = 60_000;
let roundCache = { at: 0, value: null };

async function roundStats() {
  if (roundCache.value && Date.now() - roundCache.at < ROUND_CACHE_MS) return roundCache.value;

  const rounds = await store.list('Round', {});
  const playable = rounds.filter(r => r.parse_status === 'success');
  const subject_breakdown = {};
  let questions = 0;
  for (const r of playable) {
    for (const q of r.questions || []) {
      questions++;
      const s = q.subject || 'General Science';
      subject_breakdown[s] = (subject_breakdown[s] || 0) + 1;
    }
  }
  const value = {
    rounds: rounds.length,
    playable_rounds: playable.length,
    questions,
    // A "tournament" is a distinct packet source (NSB 2024, a regional, …).
    tournaments: new Set(rounds.map(r => r.source?.trim()).filter(Boolean)).size,
    subject_breakdown,
  };
  roundCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  const { error } = await requireUser();
  if (error) return error;

  try {
    const [rounds, aggregates] = await Promise.all([roundStats(), store.statsAggregates()]);
    return NextResponse.json({ ...rounds, ...aggregates });
  } catch (err) {
    return errorResponse(err);
  }
}
