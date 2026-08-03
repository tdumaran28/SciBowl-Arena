// Bridge between Next.js route handlers and the WebSocket server that lives
// in server.js (same process, different module graphs — hence globalThis).
//
// Two shapes go over the wire:
//   • broadcast(entity, data)            — the whole record changed
//   • broadcastPatch(entity, id, patch)  — only these fields changed
//
// Patches matter during a match: a GameSession accumulates question_results
// and up to 200 chat messages, so re-sending the whole record on every buzz
// pushes tens of KB to every player many times a minute. A buzz patch is a few
// hundred bytes.
//
// Both forms are addressed to a room (the session id) when one applies, so a
// socket only receives traffic for the game it is actually in.

export function broadcast(entity, data, { room } = {}) {
  globalThis.__scibowlBroadcast?.({
    entity,
    data,
    room: room ?? (entity === 'GameSession' ? data?.id : undefined),
  });
}

export function broadcastPatch(entity, id, patch) {
  globalThis.__scibowlBroadcast?.({
    entity,
    id,
    patch,
    room: entity === 'GameSession' ? id : undefined,
  });
}
