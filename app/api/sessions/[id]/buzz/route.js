import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity } from '@server/db';
import { claimBuzz, ARBITRATION_WINDOW_MS } from '@server/buzz';
import { broadcastPatch } from '@server/realtime';

// Buzz claim with latency-compensated arbitration.
//
// The client sends the instant it buzzed, on the server's clock (see
// src/lib/clock.js). The server collects every claim that lands within
// ARBITRATION_WINDOW_MS and awards the buzz to the earliest such instant, so
// the winner is the player who actually hit the buzzer first rather than the
// one with the shortest network path. Losers get 409 with the winning state.
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    const bs = session.buzz_state || {};
    if (bs.buzzed_player_id && !bs.result) {
      return NextResponse.json({ message: 'Buzz already claimed', session }, { status: 409 });
    }
    if (bs.result === 'correct' || bs.dead) {
      return NextResponse.json({ message: 'Question already resolved', session }, { status: 409 });
    }

    const { player_id, team, display_name, buzzed_at } = body || {};
    const negged = bs.negged_teams || [];
    const neggedPlayers = bs.negged_players || [];
    if ((team && negged.includes(team)) || (!team && neggedPlayers.includes(player_id))) {
      return NextResponse.json({ message: 'Already answered this question', session }, { status: 409 });
    }

    const outcome = await claimBuzz(id, {
      playerId: player_id,
      team,
      displayName: display_name,
      buzzedAt: Number(buzzed_at),
    });

    if (!outcome.session) {
      return NextResponse.json({ message: 'Session not found' }, { status: 404 });
    }

    // One broadcast per window, from the winner's request, carrying only the
    // field that changed.
    if (outcome.winnerId === player_id) {
      broadcastPatch('GameSession', id, { buzz_state: outcome.session.buzz_state });
      return NextResponse.json({
        ...outcome.session,
        buzz_margin_ms: outcome.marginMs,
        buzz_contenders: outcome.contenders,
      });
    }

    return NextResponse.json(
      {
        message: outcome.contenders > 1
          ? `Lost the buzz by ${outcome.marginMs} ms`
          : 'Buzz already claimed',
        session: outcome.session,
        margin_ms: outcome.marginMs,
        window_ms: ARBITRATION_WINDOW_MS,
      },
      { status: 409 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
