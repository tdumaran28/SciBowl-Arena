import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity } from '@server/db';
import { applyAnswer } from '@server/match';
import { requireSessionPlayer } from '@server/sessions';
import { broadcastPatch } from '@server/realtime';

// Scoring is applied server-side so two players resolving at nearly the same
// moment can't overwrite each other's score arrays (see server/match.js).
//
// WHO answered is taken from the authenticated session and the stored roster,
// never from the request body: a body-supplied player_id let any signed-in user
// score a question onto — or a neg against — somebody else's row.
export async function POST(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const {
      result, type, interrupted,
      submitted_answer, submitted_choice, question_format,
    } = body || {};
    if (!result) {
      return NextResponse.json({ message: 'result is required' }, { status: 400 });
    }

    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    const { player, error: notInRoom } = requireSessionPlayer(session, user);
    if (notInRoom) return NextResponse.json({ message: notInRoom }, { status: 403 });

    const outcome = applyAnswer(id, {
      playerId: player.user_id,
      displayName: player.display_name,
      team: player.team || '',
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
