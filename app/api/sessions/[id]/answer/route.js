import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { applyAnswer } from '@server/match';
import { broadcastPatch } from '@server/realtime';

// Scoring is applied server-side so two players resolving at nearly the same
// moment can't overwrite each other's score arrays (see server/match.js).
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const {
      player_id, display_name, team, result, type, interrupted,
      submitted_answer, submitted_choice, question_format,
    } = body || {};
    if (!player_id || !result) {
      return NextResponse.json({ message: 'player_id and result are required' }, { status: 400 });
    }

    const outcome = applyAnswer(id, {
      playerId: player_id,
      displayName: display_name,
      team,
      result,
      type,
      interrupted,
      // The question list is derived client-side (marathon rooms have no stored
      // list at all), so the format travels with the answer — it decides how
      // many wrong answers kill the tossup.
      submittedAnswer: submitted_answer ?? null,
      submittedChoice: submitted_choice ?? null,
      questionFormat: question_format || '',
    });
    if (!outcome) return NextResponse.json({ message: 'Session not found' }, { status: 404 });
    if (outcome.rejected) {
      return NextResponse.json(
        { message: `Cannot answer: ${outcome.rejected}`, session: outcome.session },
        { status: 409 },
      );
    }

    broadcastPatch('GameSession', id, outcome.patch);
    return NextResponse.json(outcome.session);
  } catch (err) {
    return errorResponse(err);
  }
}
