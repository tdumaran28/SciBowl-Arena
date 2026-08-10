// Durable mirror of live game sessions.
//
// THE PROBLEM. A room lives in this process's memory. That is deliberate — a
// buzz claim is a synchronous read-modify-write against `server/db.js`, and
// nothing about that survives being moved behind a network call. But it also
// means the room dies with the process, and on a free-tier host the process
// dies constantly: an idle spin-down after 15 minutes, or any redeploy. Players
// mid-match got "This room is no longer available" and lost the game.
//
// THE SHAPE OF THE FIX. Postgres holds a *copy*, never the source of truth:
//
//   • every write to a GameSession is announced by server/db.js and mirrored
//     here, write-behind and debounced, so the request path never waits on it;
//   • the copy is read exactly once, at boot, to put the rooms back.
//
// Nothing reads Postgres while the server is up, so the atomicity of a buzz is
// untouched: the in-memory record is still the only thing any request consults.
// This is only safe because the app runs as exactly ONE process (see the README
// — two instances would each rehydrate the same rooms and then diverge).
//
// Everything here degrades to a no-op rather than failing a request: without
// Supabase configured, or with a database that predates the `game_sessions`
// table, matches behave exactly as they did before — they just don't survive a
// restart.

import { db, hydrateEntity, onEntityChange } from './db.js';
import * as sb from './supabase.js';

const TABLE = 'game_sessions';

// How far back to restore. Long enough that an overnight redeploy doesn't lose
// a session in progress, short enough that boot stays a single small query.
const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Rows older than this are dropped on boot — a finished game is only kept so
// the dashboard's multiplayer counts survive a restart, not forever.
const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Write-behind delay. A buzz, an answer and the advance that follows are three
// writes within a second or two; coalescing them costs at most this much state
// on an unclean kill (SIGTERM flushes, see below).
const MIRROR_DEBOUNCE_MS = 400;

let mirroring = sb.enabled;
let loadPromise = null;
const pending = new Map(); // sessionId -> timer
let transientFailures = 0;

/**
 * Something went wrong talking to the mirror.
 *
 * A MISSING TABLE is permanent — the code and the schema deploy separately, so a
 * running server can meet a database that predates `game_sessions`. Retrying
 * that forever would log on every game action, so mirroring switches off and
 * says once what to run.
 *
 * Anything else is assumed transient (a dropped connection, a paused free-tier
 * project, a rate limit) and mirroring stays ON. Disabling on the first blip
 * would trade a one-second outage for losing restart-survival until the next
 * deploy — and nothing here is on the request path, so a failed write costs
 * nothing but the next one succeeding instead.
 */
function disable(err, what) {
  if (!mirroring) return;
  const message = err?.message || String(err);
  if (/relation .*game_sessions.* does not exist/i.test(message) ||
      /could not find the table/i.test(message)) {
    mirroring = false;
    console.error(
      '[sessions] The `game_sessions` table is missing, so live matches will NOT survive a ' +
      'restart or an idle spin-down. Run supabase/schema.sql in the Supabase SQL editor.',
    );
    return;
  }
  // Rate-limited: say it on the first failure of an outage and again if it
  // persists, rather than once per game action.
  transientFailures++;
  if (transientFailures === 1 || transientFailures % 50 === 0) {
    console.error(`[sessions] ${what} failed (${message}) — retrying. Games in progress are ` +
      'unaffected; only their survival across a restart is at risk while this lasts.');
  }
}

function rowFor(session) {
  return {
    id: session.id,
    created_date: session.created_date || new Date().toISOString(),
    updated_date: session.updated_date || new Date().toISOString(),
    created_by: session.created_by || null,
    data: session,
  };
}

async function flush(id) {
  pending.delete(id);
  if (!mirroring) return;
  const client = sb.rawClient();
  if (!client) return;

  const session = (db.entities.GameSession || []).find(s => s.id === id);
  try {
    if (!session) {
      await client.from(TABLE).delete().eq('id', id);
      return;
    }
    const { error } = await client
      .from(TABLE)
      .upsert(rowFor(session), { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    transientFailures = 0;
  } catch (err) {
    disable(err, 'Mirroring a session');
  }
}

/** Queue a session for mirroring. Coalesces repeated writes to the same room. */
function schedule(id) {
  if (!mirroring || !id) return;
  if (pending.has(id)) return;
  pending.set(id, setTimeout(() => { flush(id); }, MIRROR_DEBOUNCE_MS));
}

/**
 * Write every queued session out now.
 *
 * Render sends SIGTERM before it stops a service (spin-down and redeploy
 * alike), which is the whole window in which the last few seconds of a match
 * can be saved — so the debounce is skipped and the writes are awaited.
 */
export async function flushAll() {
  const ids = [...pending.keys()];
  for (const id of ids) clearTimeout(pending.get(id));
  await Promise.all(ids.map(id => flush(id)));
}

/**
 * Restore rooms from the mirror. Idempotent, and awaited by every route that
 * reads a session, so the first request after a restart sees the rooms rather
 * than an empty store.
 */
export function ensureSessionsLoaded() {
  if (!mirroring) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = restore().then(
      (ok) => {
        // A restore that failed transiently must be retryable: holding a
        // resolved promise would mean one badly-timed blip during the first
        // request after a deploy loses every room permanently, which is the
        // exact case this exists for.
        if (!ok) loadPromise = null;
      },
      () => { loadPromise = null; },
    );
  }
  return loadPromise;
}

/** @returns {Promise<boolean>} whether the restore actually completed. */
async function restore() {
  const client = sb.rawClient();
  if (!client) return true;
  const since = new Date(Date.now() - RESTORE_WINDOW_MS).toISOString();
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .gte('updated_date', since)
      .order('updated_date', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    let restored = 0;
    let live = 0;
    for (const row of data || []) {
      const session = row?.data;
      if (!session?.id) continue;
      // A room already in memory is newer than anything on disk — this only
      // runs once, but a create racing the restore must not be rolled back.
      if ((db.entities.GameSession || []).some(s => s.id === session.id)) continue;
      hydrateEntity('GameSession', {
        ...session,
        created_date: row.created_date || session.created_date,
        updated_date: row.updated_date || session.updated_date,
      });
      restored++;
      if (session.status !== 'finished') live++;
    }
    if (restored > 0) {
      console.log(`[sessions] restored ${restored} session${restored === 1 ? '' : 's'} ` +
        `from the last 24h (${live} still in progress)`);
    }

    // Housekeeping, best-effort: a failure here is not worth a log line on
    // every boot, and the next one will try again.
    const cutoff = new Date(Date.now() - PURGE_AFTER_MS).toISOString();
    await client.from(TABLE).delete().lt('updated_date', cutoff);
    return true;
  } catch (err) {
    disable(err, 'Restoring sessions');
    // A missing table is permanent, so there is nothing to come back for; any
    // other failure is worth another attempt on the next request.
    return !mirroring;
  }
}

// Subscribe once, at import. server/store.js imports this module, and every
// route that can touch a session goes through it.
if (sb.enabled) {
  onEntityChange((type, id) => {
    if (type === 'GameSession') schedule(id);
  });

  // Spin-downs and redeploys both arrive as SIGTERM. Get the last writes out,
  // then exit — but never let a hung write hold the shutdown open: Render kills
  // the process after its grace period regardless, and taking that long to stop
  // is a slower redeploy for everyone waiting on it.
  const SHUTDOWN_FLUSH_MS = 3000;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      Promise.race([
        flushAll(),
        new Promise(resolve => setTimeout(resolve, SHUTDOWN_FLUSH_MS)),
      ]).finally(() => process.exit(0));
    });
  }
}
