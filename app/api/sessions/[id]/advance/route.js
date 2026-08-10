import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity } from '@server/db';
import {
  applyAdvance, applyStart, applyDead, applyPause, applyReturnToLobby, applyStaleBuzzRelease,
  applyEndRequest, applyEndVote, applyEndVoteClear,
} from '@server/match';
import { requireSessionPlayer } from '@server/sessions';
import { ensureSessionsLoaded } from '@server/store';
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
//   pause         — freeze the reading for the whole room (host only)
//   release_buzz  — a held buzz went stale (the holder never answered)
//   end_request   — ask the room to end the marathon (or end it, if alone)
//   end_vote      — accept or decline a standing request
//   end_clear     — withdraw a request, or clear one that has lapsed
//   lobby         — return to selection with the same players (host: play another round)
export async function POST(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    // The room may predate the process: rooms are mirrored to Postgres and put
    // back on the first request after a restart or an idle spin-down.
    await ensureSessionsLoaded();
    const body = await request.json().catch(() => ({}));
    const { action } = body || {};

    // Every one of these transitions is deliberately open to EVERY player —
    // that is what keeps a room from wedging when whoever "should" advance it
    // has disconnected. Every player *in this room*, though: rooms are
    // reachable by id to anyone signed in, so without this any user could
    // restart, skip through, or end a match they were not playing in.
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });
    const { player, error: notInRoom } = requireSessionPlayer(session, user);
    if (notInRoom) return NextResponse.json({ message: notInRoom }, { status: 403 });

    let outcome;
    switch (action) {
      case 'start': {
        // Every player is on a team before a match starts. The teams panel is
        // the only roster the room has now, and a player who never joined one
        // has no side to score for, no lockout to share and no bonus to be
        // dealt — so starting with one is a game that reads as broken rather
        // than a free-for-all.
        const teams = session.teams || [];
        const stray = (session.players || []).filter(p => !p.team);
        if (teams.length === 0 || stray.length > 0) {
          return NextResponse.json({
            message: teams.length === 0
              ? 'Create a team before starting — every player has to be on one.'
              : `Waiting on ${stray.map(p => p.display_name).join(', ')} to join a team.`,
          }, { status: 400 });
        }
        cancelWindow(id);
        outcome = applyStart(id);
        break;
      }
      case 'next':
        cancelWindow(id);
        outcome = applyAdvance(id, {
          nextIndex: Number(body.next_index) || 0,
          keepBonusOwner: !!body.keep_bonus_owner,
          finished: !!body.finished,
          // Only so a question the room stepped over can be logged as the
          // right type; the server holds no question list of its own.
          currentType: body.current_type || '',
        });
        break;
      case 'dead':
        outcome = applyDead(id, { isBonus: !!body.is_bonus });
        break;
      case 'pause':
        // Host only. Everything else here is open to every player on purpose —
        // that is what keeps a room from wedging — but a pause is the one
        // transition that *stops* the match, so it is not something any player
        // should be able to do to everyone else.
        if (session.host_id !== user.email) {
          return NextResponse.json({ message: 'Only the host can pause the match' }, { status: 403 });
        }
        outcome = applyPause(id, { paused: !!body.paused });
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
      // Ending early is a marathon affair. A round of practice ends when its
      // packet does, so there is nothing to vote about — and allowing it there
      // would put back, by another name, the early end that was deliberately
      // taken away from the host.
      case 'end_request':
      case 'end_vote':
      case 'end_clear': {
        if (session.game_type !== 'marathon') {
          return NextResponse.json(
            { message: 'Only a marathon can be ended early — a round finishes with its packet.' },
            { status: 400 },
          );
        }
        const who = { playerId: player.user_id, displayName: player.display_name };
        if (action === 'end_request') {
          cancelWindow(id);
          outcome = applyEndRequest(id, { ...who, currentType: body.current_type || '' });
        } else if (action === 'end_vote') {
          cancelWindow(id);
          outcome = applyEndVote(id, {
            ...who, accept: !!body.accept, currentType: body.current_type || '',
          });
        } else {
          // Reported by any client once a request has lapsed, and by the
          // requester to withdraw. Guarded on the timestamp server-side, so a
          // report racing an accept is a no-op.
          outcome = applyEndVoteClear(id, { playerId: player.user_id });
        }
        break;
      }
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
