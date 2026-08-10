// Buzz arbitration.
//
// The problem with "first POST to arrive wins" is that arrival order is
// dominated by network latency, not by who actually hit the buzzer first: a
// player on a 150 ms link loses to one on 20 ms even when they buzzed 100 ms
// earlier. Real Science Bowl hardware resolves this in the lockout circuit,
// where every buzzer is equidistant from the arbiter.
//
// We reproduce that by making the *client* stamp the buzz (converted to the
// server's clock via src/lib/clock.js) and having the server hold a short
// arbitration window: the first claim opens the window, every claim that
// lands inside it competes, and the earliest client-stamped instant wins.
//
// The window is the maximum latency handicap the system will absorb. It costs
// every buzz that much added delay before the lock resolves, so it wants to be
// comfortably above typical RTT spread but below human reaction resolution —
// see ARBITRATION_WINDOW_MS.

import { getEntity, updateEntity } from './db.js';
import { questionClosed } from './match.js';
import { broadcastPatch } from './realtime.js';

export const ARBITRATION_WINDOW_MS = 150;

// Claims are only ever in flight for ARBITRATION_WINDOW_MS, so an in-memory
// map is sufficient — and necessary, since this must be synchronous with the
// single-process GameSession store.
const windows = new Map(); // sessionId -> { claims, timer, promise, resolve }

function openWindow(sessionId) {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const win = { claims: [], promise, resolve, timer: null };
  win.timer = setTimeout(() => finishWindow(sessionId), ARBITRATION_WINDOW_MS);
  windows.set(sessionId, win);
  return win;
}

// Resolve the window: earliest client-stamped buzz wins. Ties (identical
// timestamps, e.g. two clients with coarse clocks) fall back to the order the
// claims reached the server, which is arbitrary but deterministic.
function finishWindow(sessionId) {
  const win = windows.get(sessionId);
  if (!win) return;
  windows.delete(sessionId);
  clearTimeout(win.timer);

  const sorted = [...win.claims].sort((a, b) =>
    a.buzzedAt - b.buzzedAt || a.receivedSeq - b.receivedSeq);
  const winner = sorted[0];

  let session = getEntity('GameSession', sessionId);
  // Whether the winner's buzz was actually recorded. If the question resolved
  // while the window was open, nobody won it — reporting a winner anyway would
  // leave that client holding a buzz the server never granted, free to answer a
  // question that is already over.
  let applied = false;
  if (session && winner) {
    const bs = session.buzz_state || {};
    // Re-check under the same synchronous critical section the claims were
    // validated in: the question may have resolved while the window was open.
    //
    // `questionClosed` and not `!bs.result`, which is the same rule the route
    // itself applies. After a wrong answer a tossup carries the loser's result
    // while it is still live for the other teams, so testing for any result at
    // all rejected the very buzz the reopen exists to allow: the next team
    // pressed the buzzer, got a 409, and watched their answer box disappear.
    if (!bs.buzzed_player_id && !questionClosed(bs)) {
      const buzz_state = {
        ...bs,
        buzzed_player_id: winner.playerId,
        buzzed_team: winner.team || '',
        buzzed_display_name: winner.displayName,
        buzzed_at: winner.buzzedAt,
        // The previous team's miss stops being the room's headline the moment
        // someone else takes the question — and leaving it set would read as
        // "resolved" to every client that asks whether a buzz is live.
        result: null,
        result_player: null,
        result_player_id: null,
        result_team: null,
        result_points: null,
        result_interrupted: false,
        // The provisional lock is now superseded by the arbitrated one.
        pending_buzz: null,
        negged_teams: bs.negged_teams || [],
        negged_players: bs.negged_players || [],
        reading_started_at: bs.reading_started_at || null,
      };
      session = updateEntity('GameSession', sessionId, { buzz_state });
      applied = true;
      // Broadcast from here rather than from the winning request's handler:
      // every client learns the outcome as soon as the window closes, instead
      // of after one more round trip to whichever player happened to win.
      broadcastPatch('GameSession', sessionId, { buzz_state });
    } else if (bs.pending_buzz) {
      // Question resolved while the window was open — drop the provisional lock
      // so it can't sit on everyone's screen.
      const buzz_state = { ...bs, pending_buzz: null };
      session = updateEntity('GameSession', sessionId, { buzz_state });
      broadcastPatch('GameSession', sessionId, { buzz_state });
    }
  }

  win.resolve({
    session,
    winnerId: applied ? winner.playerId : null,
    // Margin over the runner-up — surfaced in the UI so players can see how
    // close a buzz was, the way a real lockout box shows the lockout order.
    marginMs: sorted.length > 1 ? Math.round(sorted[1].buzzedAt - sorted[0].buzzedAt) : null,
    contenders: sorted.length,
  });
}

let seq = 0;

/**
 * Enter a buzz into the arbitration window for its session and wait for the
 * window to close. Resolves { session, winnerId, marginMs, contenders } —
 * identical for every competing claim, so each caller can tell whether it won.
 *
 * `buzzedAt` is the client's buzz instant already converted to server time.
 * It is clamped to (reading start, now] so a client cannot win by reporting a
 * time before the question began or by lagging its own clock backwards.
 */
export function claimBuzz(sessionId, { playerId, team, displayName, buzzedAt }) {
  const session = getEntity('GameSession', sessionId);
  if (!session) return Promise.resolve({ session: null, winnerId: null, notFound: true });

  const bs = session.buzz_state || {};
  const now = Date.now();
  const readingStartedAt = bs.reading_started_at || 0;
  const stamped = Number.isFinite(buzzedAt) ? buzzedAt : now;
  const clamped = Math.min(Math.max(stamped, readingStartedAt || stamped), now);

  const existing = windows.get(sessionId);
  const win = existing || openWindow(sessionId);
  win.claims.push({
    playerId,
    team,
    displayName,
    buzzedAt: clamped,
    receivedSeq: seq++,
  });

  // First claim of a window: lock every other screen NOW rather than after the
  // window closes. Waiting cost everyone ARBITRATION_WINDOW_MS plus a round
  // trip of buzzable time on a question that was already taken.
  //
  // This does not decide anything — arbitration still runs on the stamped
  // instants — and it cannot shut a rival out unfairly: a claim already in
  // flight is unaffected, and a press made *after* this frame arrives is
  // necessarily later than the pending buzz, so it would have lost anyway.
  if (!existing) {
    const buzz_state = {
      ...bs,
      pending_buzz: {
        player_id: playerId,
        team: team || '',
        display_name: displayName,
        buzzed_at: clamped,
      },
    };
    updateEntity('GameSession', sessionId, { buzz_state });
    broadcastPatch('GameSession', sessionId, { buzz_state });
  }

  return win.promise;
}

/** Drop any pending window for a session (question advanced, game ended). */
export function cancelWindow(sessionId) {
  const win = windows.get(sessionId);
  if (!win) return;
  clearTimeout(win.timer);
  windows.delete(sessionId);
  win.resolve({ session: getEntity('GameSession', sessionId), winnerId: null, cancelled: true });
}
