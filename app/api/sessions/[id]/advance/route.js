import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { applyAdvance, applyStart, applyDead, applyReturnToLobby } from '@server/match';
import { cancelWindow } from '@server/buzz';
import { broadcastPatch } from '@server/realtime';

// Question transitions. `reading_started_at` is stamped here, on the server's
// clock, because every client's reading position is derived from it — stamping
// it client-side made the whole match inherit that machine's clock error.
//
// action:
//   start   — begin the match at question 0
//   next    — move to `next_index` (or finish when `finished`)
//   dead    — tossup timed out / everyone missed it
//   lobby   — return to selection with the same players (host: play another round)
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body || {};

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
