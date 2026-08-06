import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity, updateEntity } from '@server/db';
import { broadcastPatch } from '@server/realtime';

// Leaving a room, applied server-side so it works from `navigator.sendBeacon`
// during page unload — a normal fetch is routinely cancelled there, which left
// ghost players sitting in rooms after someone closed the tab.
//
// sendBeacon cannot set an Authorization header, so unload beacons authenticate
// with the Clerk session cookie that `auth()` reads anyway.
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const { player_id } = body || {};
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    const players = (session.players || []).filter(p => p.user_id !== player_id);
    if (players.length === (session.players || []).length) {
      return NextResponse.json(session);
    }

    // A room that empties out (or drops to a single player mid-match) is over.
    const status = players.length <= 1 && session.status === 'active' ? 'finished' : session.status;
    const patch = { players, status };

    // Hand the room over when the host leaves. The host is the fallback that
    // can always advance a question and end the game, so a room whose host
    // walked out used to be one disconnect away from having nobody able to move
    // it forward.
    if (session.host_id === player_id && players.length > 0) {
      patch.host_id = players[0].user_id;
    }
    const updated = updateEntity('GameSession', id, patch);
    broadcastPatch('GameSession', id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
