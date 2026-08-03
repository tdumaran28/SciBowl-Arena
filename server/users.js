// Registered-user mirror and roles.
//
// Clerk owns identity — credentials, sessions, email verification. It does not
// own *authorization*, so the app keeps its own row per user carrying the one
// thing it needs to make decisions: the role.
//
//   admin  — may create and edit public packets (and private ones)
//   player — may create and edit only their own private packets
//
// The row is created on first authenticated request, so the table fills itself
// as people sign in; there is no separate provisioning step.

import * as store from './store.js';

export const ROLES = { ADMIN: 'admin', PLAYER: 'player' };

export function isAdmin(user) {
  return user?.role === ROLES.ADMIN;
}

// Comma-separated allowlist, e.g. ADMIN_EMAILS="a@x.com,b@y.com". Anyone listed
// is an admin on sign-in regardless of what the table says, which is the
// recovery path if the roles get into a bad state.
function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// The very first person to sign in becomes admin: a fresh deployment with no
// admins would otherwise have nobody able to publish a public packet, and no
// way to promote anyone.
async function shouldBootstrapAdmin() {
  try {
    return (await store.count('AppUser')) === 0;
  } catch {
    return false;
  }
}

// Emails are stored and compared lowercased, matching the unique index in
// schema.sql (`lower(email)`). Without this a user signing in as
// Alice@x.com after registering as alice@x.com would look absent and the
// insert would then fail against that index.
export function normalizeEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

/**
 * Find this person's row. Email is the primary key of identity here — it is
 * what every other table (stats, leaderboard, round ownership) is keyed by —
 * so it is checked first. The Clerk id is the fallback for a row whose email
 * has since changed.
 */
async function findExisting({ id, email }) {
  if (email) {
    const [byEmail] = await store.list('AppUser', { filter: { email }, limit: 1 });
    if (byEmail) return byEmail;
  }
  return id ? store.get('AppUser', id) : null;
}

/**
 * Ensure a row exists for this Clerk user and return it (with `role`).
 *
 * Called on every authenticated request: if the email is already on the list
 * the row is refreshed (so a name change in Clerk propagates) and its existing
 * role is kept; if it is not, a new row is created with the default `player`
 * role. Roles are only ever changed through setRole().
 */
export async function ensureUser({ id, email, full_name }) {
  const normalized = normalizeEmail(email);
  const existing = await findExisting({ id, email: normalized });

  let role = existing?.role || ROLES.PLAYER;
  if (normalized && envAdminEmails().includes(normalized)) role = ROLES.ADMIN;
  else if (!existing && await shouldBootstrapAdmin()) role = ROLES.ADMIN;

  const profile = {
    email: normalized || existing?.email || null,
    full_name: full_name || existing?.full_name || null,
    role,
  };

  // Update the row that already exists, whatever its id — reusing the Clerk id
  // for an email that is already present would violate the unique email index
  // (which happens when a Clerk account is deleted and recreated). Create and
  // update rather than upsert, so created_date keeps meaning "first seen".
  if (existing) {
    const unchanged = existing.email === profile.email
      && existing.full_name === profile.full_name
      && existing.role === profile.role;
    // Every authenticated request lands here; skip the write when nothing moved.
    return unchanged ? existing : store.update('AppUser', existing.id, profile);
  }

  return store.create('AppUser', { id, ...profile }, normalized);
}

/** Change a user's role. Callers must verify the actor is an admin. */
export async function setRole(userId, role) {
  if (![ROLES.ADMIN, ROLES.PLAYER].includes(role)) {
    throw Object.assign(new Error(`Invalid role: ${role}`), { status: 400 });
  }
  return store.update('AppUser', userId, { role });
}

export async function listUsers() {
  return store.list('AppUser', { sort: '-created_date' });
}
