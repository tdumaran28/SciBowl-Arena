import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity } from '@server/db';
import { applyAdvance, applyStart, applyDead, applyReturnToLobby, applyStaleBuzzRelease } from '@server/match';
import { requireSessionPlayer } from '@server/sessions';
import { cancelWindow } from '@server/buzz';
import { broadcastPatch } from '@server/realtime';

// Question transitions. `reading_started_at` is stamped here, on the server's
// clock, because every client's reading position is derived from it — stamping
// it client-side made the whole match inherit that machine's clock error.
//
// action:
//   start         — begin the match at question 0
//   next          — move to `next_index` (or finish when `finished`)
//   dead          — tossup timed out / everyone missed it
//   release_buzz  — a held buzz went stale (the holder never answered)
//   lobby         — return to selection with the same players (host: play another round)
export async function POST(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body || {};

    // Every one of these transitions is deliberately open to EVERY player —
    // that is what keeps a room from wedging when whoever "should" advance it
    // has disconnected. Every player *in this room*, though: rooms are
    // reachable by id to anyone signed in, so without this any user could
    // restart, skip through, or end a match they were not playing in.
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });
    const { error: notInRoom } = requireSessionPlayer(session, user);
    if (notInRoom) return NextResponse.json({ message: notInRoom }, { status: 403 });

    let outcome;
    switch (action) {
      case 'start':
        cancelWindow(id);
        outcome = applyStart(id);
        break;
      case 'next':
        cancelWindow(id);
        outcome = applyAdvance(id, {
          nextIndex: Number(body.next_index) || 0,
          keepBonusOwner: !!body.keep_bonus_owner,
          finished: !!body.finished,
        });
        break;
      case 'dead':
        outcome = applyDead(id, { isBonus: !!body.is_bonus });
        break;
      case 'release_buzz':
        // Reported by any client when a buzz has been held far past the answer
        // window — the holder's tab froze or went away. Self-guarding, so a
        // report that races a real answer is a no-op.
        outcome = applyStaleBuzzRelease(id, {
          isBonus: !!body.is_bonus,
          questionFormat: body.question_format || '',
        });
        break;
      case 'lobby':
        cancelWindow(id);
        outcome = applyReturnToLobby(id, {
          roundId: body.round_id || '',
          gameType: body.game_type || null,
          resetScores: body.reset_scores !== false,
        });
        break;
      default:
        return NextResponse.json({ message: `Unknown action: ${action}` }, { status: 400 });
    }

    if (!outcome) return NextResponse.json({ message: 'Session not found' }, { status: 404 });
    if (outcome.patch) broadcastPatch('GameSession', id, outcome.patch);
    return NextResponse.json(outcome.session);
  } catch (err) {
    return errorResponse(err);
  }
}
