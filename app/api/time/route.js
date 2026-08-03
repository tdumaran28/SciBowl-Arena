import { NextResponse } from 'next/server';

// Server clock reference for the offset handshake in src/lib/clock.js.
//
// Everything time-sensitive in a match — when reading started, when a player
// buzzed — is expressed on the SERVER's clock, because player machines'
// wall clocks routinely disagree by seconds. Clients measure their own offset
// against this endpoint and convert before sending or interpreting timestamps.
//
// Deliberately unauthenticated and side-effect free: it must be as cheap and
// as low-jitter as possible, since the measured round-trip is the error bound
// on the offset. Anything it did beyond reading the clock would show up as
// buzz-timing noise.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  );
}
