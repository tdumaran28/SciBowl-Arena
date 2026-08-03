// Round visibility and authorization.
//
// A round is either PUBLIC (in the shared library, everyone sees it) or
// PRIVATE (only its owner sees it in the library). Who may create which:
//
//   admin  → public or private
//   player → private only
//
// Private does not mean unplayable by others: when a host picks one of their
// private packets for a multiplayer room, everyone in that room plays it. The
// restriction is on *browsing and editing*, not on being dealt the questions —
// which is why questions for an in-progress session are served through
// canPlayRound() rather than the library filter.

import * as store from './store.js';
import * as sb from './supabase.js';
import { isAdmin } from './users.js';

// Ownership is read only from fields the server writes: `owner_email` is
// stamped by authorizeRoundWrite, `created_by` by the store. `uploaded_by`
// deliberately does not count — it sits in the client-writable jsonb blob, so
// honouring it would let a caller claim someone else's packet by naming them.
function ownsRound(round, user) {
  const owner = round?.owner_email || round?.created_by;
  return Boolean(owner && user?.email && String(owner).toLowerCase() === user.email.toLowerCase());
}

/** May this user see the round in their library? */
export function canSeeRound(round, user) {
  return Boolean(round?.is_public) || ownsRound(round, user) || isAdmin(user);
}

/** May this user edit or delete the round? */
export function canEditRound(round, user) {
  if (isAdmin(user)) return true;
  // A player may only touch their own private rounds — never a public one,
  // even if they are the one who uploaded it before being demoted.
  return ownsRound(round, user) && !round?.is_public;
}

/**
 * Validate a create/update payload against the actor's role. Returns the
 * fields to persist, or throws a 403.
 */
export function authorizeRoundWrite(input, user, { existing = null } = {}) {
  const wantsPublic = input.is_public === undefined
    ? Boolean(existing?.is_public)
    : Boolean(input.is_public);

  if (wantsPublic && !isAdmin(user)) {
    throw Object.assign(
      new Error('Only admins can create or publish public packets. Save it as private instead.'),
      { status: 403 },
    );
  }
  if (existing && !canEditRound(existing, user)) {
    throw Object.assign(new Error('You can only edit your own private packets.'), { status: 403 });
  }

  return {
    ...input,
    is_public: wantsPublic,
    // Ownership is set once, by the server, from the authenticated caller —
    // never taken from the request body.
    owner_email: existing?.owner_email || user?.email || null,
  };
}

/**
 * Rounds this user may browse: every public round, plus their own private
 * ones. Admins see everything.
 */
export async function listVisibleRounds(user, { filter = null, sort = null, limit = null } = {}) {
  const baseFilter = { ...(filter || {}) };

  if (isAdmin(user)) {
    return store.list('Round', { filter: baseFilter, sort, limit });
  }

  // Supabase can express "public OR mine" in one query; the local JSON store
  // has no or-filter, so it falls back to filtering in memory.
  if (sb.enabled) {
    const publicCol = sb.columnFor('Round', 'is_public');
    const ownerCol = sb.columnFor('Round', 'owner_email');
    // The address goes into a PostgREST or-expression, where a comma or a
    // parenthesis would change the shape of the filter rather than be matched
    // literally. Only interpolate an address that cannot do that; anything
    // else falls back to public-only, which fails closed.
    const email = user?.email;
    const safeEmail = typeof email === 'string' && /^[^\s",()\\]+@[^\s",()\\]+$/.test(email)
      ? email
      : null;
    const or = safeEmail
      ? `${publicCol}.eq.true,${ownerCol}.eq."${safeEmail}"`
      : `${publicCol}.eq.true`;
    return sb.list('Round', { filter: baseFilter, sort, limit, or });
  }

  const all = await store.list('Round', { filter: baseFilter, sort });
  const visible = all.filter(r => canSeeRound(r, user));
  return limit ? visible.slice(0, Number(limit)) : visible;
}

/**
 * Which of these round ids may this user reference? One query rather than one
 * per id: a marathon room names its whole packet list, which is the entire
 * public library by default — checking those one at a time would be a hundred
 * round trips on room creation.
 *
 * Only the visibility columns are selected, never `questions`, so this stays
 * cheap no matter how many packets are involved.
 */
export async function filterVisibleIds(ids, user) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Set();

  if (sb.enabled) {
    const rows = await sb.selectColumns('Round', ['id', 'is_public', 'owner_email', 'created_by'], unique);
    return new Set(rows.filter(r => canSeeRound(r, user)).map(r => r.id));
  }

  const visible = new Set();
  for (const id of unique) {
    const round = await store.get('Round', id);
    if (round && canSeeRound(round, user)) visible.add(id);
  }
  return visible;
}

/**
 * Fetch a round for *playing*. Deliberately more permissive than the library
 * filter: a private packet a host chose for a multiplayer room has to reach
 * every player in that room, so membership of a session that references the
 * round grants access to it.
 */
export async function getPlayableRound(roundId, user, { sessionRoundIds = [] } = {}) {
  const round = await store.get('Round', roundId);
  if (!round) return null;
  if (canSeeRound(round, user)) return round;
  if (sessionRoundIds.includes(roundId)) return round;
  return null;
}
