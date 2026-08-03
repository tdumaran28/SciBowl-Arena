import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { db } from '@server/db';
import * as store from '@server/store';

// Aggregated dashboard stats, computed server-side over the whole database so
// counts never cap out at a client fetch limit.
export async function GET() {
  const { error } = await requireUser();
  if (error) return error;

  try {
    const rounds = db.entities.Round;
    const playable = rounds.filter(r => r.parse_status === 'success');
    const subjectBreakdown = {};
    let questionCount = 0;
    for (const r of playable) {
      for (const q of r.questions || []) {
        questionCount++;
        const s = q.subject || 'General Science';
        subjectBreakdown[s] = (subjectBreakdown[s] || 0) + 1;
      }
    }
    const aggregates = await store.statsAggregates();
    return NextResponse.json({
      rounds: rounds.length,
      playable_rounds: playable.length,
      questions: questionCount,
      tournaments: new Set(rounds.map(r => r.source).filter(Boolean)).size,
      subject_breakdown: subjectBreakdown,
      ...aggregates,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
