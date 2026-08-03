// Server-clock synchronization.
//
// Multiplayer timing must not depend on player machines' wall clocks: two
// browsers can easily be seconds apart, which would desynchronize question
// reading (everyone fast-forwards to a different word) and make buzz
// timestamps incomparable. So every shared timestamp is expressed on the
// server's clock, and each client measures its own offset against it.
//
// The measurement is the standard NTP-style estimate: with t0 = send time,
// t1 = receive time (both local) and `server` the server's clock at the
// midpoint, the local clock leads the server by
//
//     offset = (t0 + t1) / 2 - server
//
// so serverNow() = Date.now() - offset. Assuming a symmetric round trip, the
// error is bounded by half the RTT — which is why we take several samples and
// keep the one with the lowest RTT rather than averaging (a single delayed
// response skews a mean far more than it does a best-of).

const SAMPLES = 5;
const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

let offsetMs = 0;
let bestRttMs = Infinity;
let syncedAt = 0;
let inFlight = null;

async function sample() {
  const t0 = Date.now();
  const res = await fetch('/api/time', { cache: 'no-store' });
  const t1 = Date.now();
  if (!res.ok) throw new Error(`time sync failed (${res.status})`);
  const { now } = await res.json();
  return { rtt: t1 - t0, offset: (t0 + t1) / 2 - now };
}

async function measure() {
  let best = null;
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const s = await sample();
      if (!best || s.rtt < best.rtt) best = s;
    } catch {
      // A failed probe just means one fewer sample; a total failure leaves the
      // offset at its previous value (0 on first run), which degrades to the
      // old local-clock behaviour rather than breaking the match.
    }
  }
  if (best) {
    offsetMs = best.offset;
    bestRttMs = best.rtt;
    syncedAt = Date.now();
  }
  return { offsetMs, rttMs: bestRttMs };
}

/**
 * Measure the offset (once per RESYNC_INTERVAL_MS unless `force`). Concurrent
 * callers share one measurement.
 */
export function syncClock({ force = false } = {}) {
  if (!force && syncedAt && Date.now() - syncedAt < RESYNC_INTERVAL_MS) {
    return Promise.resolve({ offsetMs, rttMs: bestRttMs });
  }
  if (!inFlight) {
    inFlight = measure().finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Current time on the server's clock. */
export function serverNow() {
  return Date.now() - offsetMs;
}

/** Convert a local Date.now()/performance-derived instant to server time. */
export function toServerTime(localMs) {
  return localMs - offsetMs;
}

/** Convert a server timestamp to this machine's clock (for local countdowns). */
export function toLocalTime(serverMs) {
  return serverMs + offsetMs;
}

/** Diagnostics for the UI: how far off we are and how good the estimate is. */
export function clockInfo() {
  return { offsetMs, rttMs: bestRttMs, syncedAt, synced: syncedAt > 0 };
}
