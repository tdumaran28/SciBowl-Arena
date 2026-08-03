import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { ENTITY_TYPES } from '@server/db';
import * as store from '@server/store';
import { broadcast } from '@server/realtime';
import { listVisibleRounds, authorizeRoundWrite } from '@server/rounds';
import { authorizeSessionCreate } from '@server/sessions';
import { isAdmin } from '@server/users';

function badType(type) {
  if (ENTITY_TYPES.includes(type)) return null;
  return NextResponse.json({ message: `Unknown entity type: ${type}` }, { status: 404 });
}

export async function GET(request, { params }) {
  const { type } = await params;
  const invalid = badType(type);
  if (invalid) return invalid;
  const { user, error } = await requireUser();
  if (error) return error;

  // The user directory is admin-only — it lists every registered account.
  if (type === 'AppUser' && !isAdmin(user)) {
    return NextResponse.json({ message: 'Admins only' }, { status: 403 });
  }

  const url = new URL(request.url);
  let filter = null;
  if (url.searchParams.get('filter')) {
    try { filter = JSON.parse(url.searchParams.get('filter')); } catch {
      return NextResponse.json({ message: 'Bad filter' }, { status: 400 });
    }
  }
  const sort = url.searchParams.get('sort') || null;
  const limit = url.searchParams.get('limit') || null;

  try {
    // Rounds are visibility-scoped: public ones plus the caller's own private
    // ones. Everything else lists as before.
    const records = type === 'Round'
      ? await listVisibleRounds(user, { filter, sort, limit })
      : await store.list(type, { filter, sort, limit });
    return NextResponse.json(records);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request, { params }) {
  const { type } = await params;
  const invalid = badType(type);
  if (invalid) return invalid;
  const { user, error } = await requireUser();
  if (error) return error;

  // Rows here are mirrored from Clerk on sign-in, never created by hand.
  if (type === 'AppUser') {
    return NextResponse.json({ message: 'Users are provisioned automatically' }, { status: 403 });
  }

  try {
    let body = await request.json().catch(() => ({}));
    if (type === 'Round') body = authorizeRoundWrite(body || {}, user);
    if (type === 'GameSession') body = await authorizeSessionCreate(body || {}, user);
    const record = await store.create(type, body || {}, user.email);
    broadcast(type, record);
    return NextResponse.json(record);
  } catch (err) {
    return errorResponse(err);
  }
}
