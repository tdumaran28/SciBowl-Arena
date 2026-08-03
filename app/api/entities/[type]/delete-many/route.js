import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@server/auth';
import { ENTITY_TYPES } from '@server/db';
import * as store from '@server/store';
import { isAdmin } from '@server/users';

export async function POST(request, { params }) {
  const { type } = await params;
  if (!ENTITY_TYPES.includes(type)) {
    return NextResponse.json({ message: `Unknown entity type: ${type}` }, { status: 404 });
  }
  const { user, error } = await requireUser();
  if (error) return error;

  if (type === 'AppUser') {
    return NextResponse.json({ message: 'Users are managed through Clerk' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    let filter = body?.filter;
    if (!filter || Object.keys(filter).length === 0) {
      return NextResponse.json({ message: 'delete-many requires a non-empty filter' }, { status: 400 });
    }

    // A bulk delete is the one path that could reach rounds the caller may not
    // touch one at a time, so pin non-admins to their own private packets by
    // intersecting the filter rather than trusting the one they sent.
    if (type === 'Round' && !isAdmin(user)) {
      filter = { ...filter, owner_email: user.email, is_public: false };
    }

    const removed = await store.removeMany(type, filter);
    return NextResponse.json({ removed });
  } catch (err) {
    return errorResponse(err);
  }
}
