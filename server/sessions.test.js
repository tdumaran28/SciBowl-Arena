// Game-session authorization: node --test server/
//
// Rooms are readable by id to any signed-in user — that is how joining by room
// code works — so every match route has to establish who is acting from the
// session itself. This is that chokepoint, and the reason it exists is that
// taking the acting player from the request body let any signed-in user score a
// question onto someone else's row, chat as them, or drop them out of a live
// match. None of it was reachable through the UI; all of it was reachable with
// a fetch.
//
// The datastore is resolved from process.cwd(), so run in a temp directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scibowl-sessions-'));
process.chdir(tmp);

const { requireSessionPlayer } = await import('./sessions.js');

const room = {
  host_id: 'host@x.com',
  players: [
    { user_id: 'host@x.com', display_name: 'Hosty', team: 'Red', score: 4 },
    { user_id: 'member@x.com', display_name: 'Mem', team: 'Blue', score: 0 },
  ],
};

const asUser = (email, full_name = 'Someone') => ({ id: `clerk_${email}`, email, full_name });

test('a member acts as their own roster entry', () => {
  const { player, error } = requireSessionPlayer(room, asUser('member@x.com'));
  assert.equal(error, undefined);
  assert.equal(player.user_id, 'member@x.com');
  // Name and team come from the roster, not from whatever the caller sent —
  // these are what every other player's screen shows, so the request's copy was
  // the one that could disagree.
  assert.equal(player.display_name, 'Mem');
  assert.equal(player.team, 'Blue');
});

test('a signed-in stranger is not in the room', () => {
  const { player, error } = requireSessionPlayer(room, asUser('nosy@x.com'));
  assert.equal(player, undefined);
  assert.equal(error, 'You are not in this room');
});

test('a stranger cannot act by naming a member — there is nothing to name', () => {
  // The only input is the authenticated user, so impersonation has no surface:
  // the same call for the same stranger is rejected no matter what a body said.
  const spoofed = { ...asUser('nosy@x.com'), player_id: 'member@x.com', display_name: 'Mem' };
  assert.equal(requireSessionPlayer(room, spoofed).error, 'You are not in this room');
});

test('the host acts even when they are no longer on the roster', () => {
  // The host stays authoritative over the room in the window after they leave —
  // ending a game they have walked out of, for instance — so the room does not
  // wedge on a roster that has not caught up.
  const hostLeft = { ...room, players: room.players.filter(p => p.user_id !== 'host@x.com') };
  const { player, error } = requireSessionPlayer(hostLeft, asUser('host@x.com', 'Hosty'));
  assert.equal(error, undefined);
  assert.equal(player.user_id, 'host@x.com');
  assert.equal(player.team, '');
});

test('an unauthenticated or emailless caller is never a member', () => {
  for (const user of [null, undefined, {}, { id: 'clerk_x', email: null }]) {
    assert.equal(requireSessionPlayer(room, user).error, 'You are not in this room');
  }
});

test('a room with no roster admits nobody but its host', () => {
  assert.equal(requireSessionPlayer({ host_id: 'host@x.com' }, asUser('member@x.com')).error,
    'You are not in this room');
  assert.equal(requireSessionPlayer({ host_id: 'host@x.com' }, asUser('host@x.com')).error, undefined);
  // And a session that is missing entirely is not a way in.
  assert.equal(requireSessionPlayer(null, asUser('host@x.com')).error, 'You are not in this room');
});
