import { NextResponse } from 'next/server';
import { requireUser, errorResponse, invalidateUser } from '@server/auth';
import { ENTITY_TYPES } from '@server/db';
import * as store from '@server/store';
import { broadcast } from '@server/realtime';
import { authorizeRoundWrite, canEditRound } from '@server/rounds';
import { authorizeSessionUpdate } from '@server/sessions';
import { isAdmin, setRole } from '@server/users';

function badType(type) {
  if (ENTITY_TYPES.includes(type)) return null;
  return NextResponse.json({ message: `Unknown entity type: ${type}` }, { status: 404 });
}

export async function PATCH(request, { params }) {
  const { type, id } = await params;
  const invalid = badType(type);
  if (invalid) return invalid;
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));

    // Role changes are the only editable part of a user row, and only by an
    // admin. Everything else about a user comes from Clerk.
    if (type === 'AppUser') {
      if (!isAdmin(user)) return NextResponse.json({ message: 'Admins only' }, { status: 403 });
      if (!body?.role) return NextResponse.json({ message: 'Only `role` is editable' }, { status: 400 });
      if (id === user.id && body.role !== 'admin') {
        // Removing your own admin rights can leave a deployment with no admin.
        return NextResponse.json({ message: 'You cannot remove your own admin role' }, { status: 400 });
      }
      const record = await setRole(id, body.role);
      if (!record) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      invalidateUser(id); // so the new role applies on their next request
      return NextResponse.json(record);
    }

    let input = body || {};
    if (type === 'Round') {
      const existing = await store.get('Round', id);
      if (!existing) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      input = authorizeRoundWrite(input, user, { existing });
    }
    if (type === 'GameSession') {
      await store.ensureSessionsLoaded();
      const existing = await store.get('GameSession', id);
      if (!existing) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      input = await authorizeSessionUpdate(input, user, existing);
    }

    const record = await store.update(type, id, input);
    if (!record) return NextResponse.json({ message: 'Not found' }, { status: 404 });
    broadcast(type, record);
    return NextResponse.json(record);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request, { params }) {
  const { type, id } = await params;
  const invalid = badType(type);
  if (invalid) return invalid;
  const { user, error } = await requireUser();
  if (error) return error;

  if (type === 'AppUser') {
    return NextResponse.json({ message: 'Users are managed through Clerk' }, { status: 403 });
  }

  try {
    if (type === 'Round') {
      const existing = await store.get('Round', id);
      if (!existing) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      if (!canEditRound(existing, user)) {
        return NextResponse.json(
          { message: 'You can only delete your own private packets.' },
          { status: 403 },
        );
      }
    }

    if (!(await store.remove(type, id))) {
      return NextResponse.json({ message: 'Not found' }, { status: 404 });
    }
    broadcast(type, { id, deleted: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
