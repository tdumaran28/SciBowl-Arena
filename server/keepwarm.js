// Keep the instance from being spun down mid-match.
//
// A free Render service sleeps after ~15 minutes without *inbound* traffic, and
// its own health checks do not count — the request has to arrive from outside.
// A request the server makes to its own public URL does: it leaves the
// container, goes through Render's router, and comes back in as ordinary
// traffic. So the app can keep itself awake without a third-party pinger.
//
// This is the second half of the fix, not the whole of it: it stops an idle
// spin-down from ending a game, but nothing stops a redeploy. That case is
// covered by server/sessionStore.js, which puts the rooms back afterwards.
//
// Configuration (all optional — unset means off):
//   KEEP_WARM_URL      the app's own public origin. Render injects
//                      RENDER_EXTERNAL_URL, which is used when this is unset.
//   KEEP_WARM_MINUTES  interval, default 10 (must stay under Render's 15).
//   KEEP_WARM_MODE     'always' (default) keeps the service up around the
//                      clock — 744 h in a 31-day month against a 750 h monthly
//                      allowance, so exactly one service fits and a second one
//                      will not. 'active' pings only while someone is connected,
//                      which spends far fewer instance-hours and still cannot
//                      let a spin-down land in the middle of a match; the cost
//                      is a cold start for the first player each session.

const PATH = '/api/time'; // unauthenticated, and does nothing but read the clock

export function startKeepWarm({ isActive = () => true } = {}) {
  const base = (process.env.KEEP_WARM_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!base) return null;

  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    console.error(`[keepwarm] KEEP_WARM_URL is not a URL: ${base} — self-ping disabled`);
    return null;
  }

  const minutes = Number(process.env.KEEP_WARM_MINUTES || 10);
  // Above 14 the ping is useless (the service is already asleep by then), and
  // below 1 it is just noise.
  const everyMs = Math.min(Math.max(minutes, 1), 14) * 60 * 1000;
  const onlyWhenActive = (process.env.KEEP_WARM_MODE || 'always') === 'active';

  let failures = 0;
  const tick = async () => {
    if (onlyWhenActive && !isActive()) return;
    try {
      const res = await fetch(`${origin}${PATH}`, {
        cache: 'no-store',
        headers: { 'user-agent': 'scibowl-keepwarm' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      failures = 0;
    } catch (err) {
      // Say it once per outage rather than every ten minutes forever: a wrong
      // URL here is silent otherwise, and the symptom (matches ending) shows up
      // hours later somewhere else entirely.
      failures++;
      if (failures === 1 || failures === 5) {
        console.error(`[keepwarm] ${origin}${PATH} failed (${err.message}) — the service may ` +
          'still sleep. Check KEEP_WARM_URL points at this deployment.');
      }
    }
  };

  const timer = setInterval(tick, everyMs);
  // Never hold the process open on its own account.
  timer.unref?.();
  console.log(`[keepwarm] self-ping ${origin}${PATH} every ${everyMs / 60000} min` +
    `${onlyWhenActive ? ' while players are connected' : ''}`);
  return () => clearInterval(timer);
}
