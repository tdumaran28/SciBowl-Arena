import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { getEntity, updateEntity } from '@server/db';
import { broadcastPatch } from '@server/realtime';

// Chat is a server-side append so two people sending at the same moment can't
// overwrite each other's messages.
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const session = getEntity('GameSession', id);
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 });

    const { sender_id, sender_name, text } = body || {};
    if (!text?.trim()) return NextResponse.json({ message: 'Empty message' }, { status: 400 });

    const msg = { sender_id, sender_name, text: text.trim(), ts: new Date().toISOString() };
    const chat_messages = [...(session.chat_messages || []), msg].slice(-200);
    const updated = updateEntity('GameSession', session.id, { chat_messages });
    broadcastPatch('GameSession', session.id, { chat_messages });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
