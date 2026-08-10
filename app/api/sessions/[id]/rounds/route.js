import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity } from '@server/db';
import * as store from '@server/store';
import { canReadSessionRounds } from '@server/sessions';

// The rounds a game session references, regardless of who owns them.
//
// This is how a PRIVATE packet is shared: private means "not in anyone else's
// library", not "unplayable by anyone else". When a host picks one of their own
// private packets for a room, every player in that room needs its questions —
// so membership of the session, not ownership of the round, is what grants
// access here.
//
// Access is limited to the session's referenced rounds and nothing else, so it
// cannot be used to enumerate another user's private library.
export async function GET(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    await store.ensureSessionsLoaded();
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    // Members only. Joining adds you to the roster first, so this still covers
    // arriving mid-match — while stopping someone who merely guesses a session
    // id from reading the packets it references.
    if (!canReadSessionRounds(session, user)) {
      return NextResponse.json({ message: 'You are not in this room' }, { status: 403 });
    }

    const ids = [session.round_id, ...(session.round_ids || [])].filter(Boolean);
    if (ids.length === 0) return NextResponse.json([]);

    const rounds = await Promise.all([...new Set(ids)].map(rid => store.get('Round', rid)));
    return NextResponse.json(rounds.filter(Boolean));
  } catch (err) {
    return errorResponse(err);
  }
}
