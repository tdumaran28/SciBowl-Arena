import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity, updateEntity } from '@server/db';
import { requireSessionPlayer } from '@server/sessions';
import { broadcastPatch } from '@server/realtime';

// Chat is a server-side append so two people sending at the same moment can't
// overwrite each other's messages.
//
// The sender is the authenticated member of this room. Taking it from the body
// let anyone who knew a session id post into that room under another player's
// name — and rooms are reachable by id to every signed-in user.
export async function POST(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    const { player, error: notInRoom } = requireSessionPlayer(session, user);
    if (notInRoom) return NextResponse.json({ message: notInRoom }, { status: 403 });

    const { text } = body || {};
    if (!text?.trim()) return NextResponse.json({ message: 'Empty message' }, { status: 400 });

    const msg = {
      sender_id: player.user_id,
      sender_name: player.display_name,
      text: text.trim(),
      ts: new Date().toISOString(),
    };
    const chat_messages = [...(session.chat_messages || []), msg].slice(-200);
    const updated = updateEntity('GameSession', session.id, { chat_messages });
    broadcastPatch('GameSession', session.id, { chat_messages });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
