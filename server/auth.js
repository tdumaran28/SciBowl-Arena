// Clerk auth for Next.js route handlers. Resolves the caller to
// { id, email, full_name, role } (email keys all app data), with a small cache.
//
// Clerk authenticates; the app's own app_users table authorizes (see
// server/users.js). The row is created on first request here, so signing in is
// all it takes to be registered.
import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ensureUser, ROLES } from './users.js';

export const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

const USER_TTL_MS = 5 * 60 * 1000;
const userCache = new Map(); // clerkUserId -> { user, expires }

export async function resolveUser(clerkUserId) {
  const cached = userCache.get(clerkUserId);
  if (cached && cached.expires > Date.now()) return cached.user;

  const client = await clerkClient();
  const u = await client.users.getUser(clerkUserId);
  const email =
    u.emailAddresses?.find(e => e.id === u.primaryEmailAddressId)?.emailAddress ||
    u.emailAddresses?.[0]?.emailAddress ||
    null;
  const user = {
    id: u.id,
    email,
    full_name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || email?.split('@')[0] || 'Player',
  };

  // Mirror into app_users and pick up the role. A failure here must not lock
  // anyone out of the app, so it degrades to the least-privileged role.
  try {
    const record = await ensureUser(user);
    user.role = record?.role || ROLES.PLAYER;
  } catch (err) {
    console.error('[auth] could not resolve role:', err.message);
    user.role = ROLES.PLAYER;
  }

  userCache.set(clerkUserId, { user, expires: Date.now() + USER_TTL_MS });
  return user;
}

/** Clear a user's cached identity so a role change takes effect immediately. */
export function invalidateUser(clerkUserId) {
  userCache.delete(clerkUserId);
}

// Returns the resolved user, or a NextResponse error to return as-is.
export async function requireUser() {
  if (!clerkConfigured) {
    return {
      error: NextResponse.json(
        { message: 'Authentication is not configured. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.local (see README) and restart the server.' },
        { status: 503 },
      ),
    };
  }
  try {
    const { userId } = await auth();
    if (!userId) {
      return { error: NextResponse.json({ message: 'Authentication required' }, { status: 401 }) };
    }
    return { user: await resolveUser(userId) };
  } catch (err) {
    console.error('[auth]', err.message);
    return { error: NextResponse.json({ message: 'Authentication failed' }, { status: 401 }) };
  }
}

export function errorResponse(err) {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  return NextResponse.json({ message: err.message || 'Server error' }, { status });
}
