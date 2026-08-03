// SciBowl Arena API client — talks to the self-hosted server in /server.
// Auth tokens come from Clerk: AuthContext registers a token getter here once
// the Clerk session is loaded. Keeps the same interface the app used with the
// Base44 SDK (`base44.entities.*`, `base44.integrations.Core.UploadFile`).

let authTokenGetter = null;

// Called by AuthContext with Clerk's `getToken` (returns a fresh short-lived
// session JWT on every call).
export function setAuthTokenGetter(getter) {
  authTokenGetter = getter;
}

async function getAuthToken() {
  if (!authTokenGetter) return null;
  try { return await authTokenGetter(); } catch { return null; }
}

async function request(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Realtime (WebSocket) ─────────────────────────────────────────────────────

let ws = null;
let wsConnecting = false;
let reconnectDelay = 500;
const subscribers = new Map(); // entityType -> Set<cb>
const rooms = new Set();       // room ids this client wants frames for

// Frames arrive in two shapes (see server/realtime.js): a whole record
// (`data`) or a field-level patch (`id` + `patch`). Subscribers receive
// { data } or { id, patch } and merge accordingly — patches keep per-buzz
// traffic to a few hundred bytes instead of the whole growing session.
function deliver(msg) {
  const cbs = subscribers.get(msg.entity);
  if (!cbs) return;
  const event = msg.patch ? { id: msg.id, patch: msg.patch } : { data: msg.data };
  for (const cb of cbs) cb(event);
}

// A dropped socket means missed frames, so reconnecting is not enough: every
// subscriber has to reconcile with authoritative state. Without this the app
// waited on a slow poll and could sit stale in the middle of a question.
function notifyResync() {
  for (const cbs of subscribers.values()) {
    for (const cb of cbs) cb({ resync: true });
  }
}

async function connectWs() {
  if (ws || wsConnecting) return;
  wsConnecting = true;
  const token = await getAuthToken();
  wsConnecting = false;
  if (!token) return;

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
  ws = socket;
  const hadConnected = reconnectDelay > 500;
  socket.onopen = () => {
    reconnectDelay = 500;
    for (const room of rooms) socket.send(JSON.stringify({ type: 'subscribe', room }));
    if (hadConnected) notifyResync();
  };
  socket.onmessage = (event) => {
    try { deliver(JSON.parse(event.data)); } catch { /* ignore malformed frames */ }
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    if ([...subscribers.values()].some(s => s.size > 0)) {
      setTimeout(connectWs, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    }
  };
  socket.onerror = () => socket.close();
}

function subscribe(entityType, cb) {
  if (!subscribers.has(entityType)) subscribers.set(entityType, new Set());
  subscribers.get(entityType).add(cb);
  connectWs();
  return () => {
    subscribers.get(entityType)?.delete(cb);
  };
}

// Room membership: the server only sends a room's frames to sockets that asked
// for them, so a client never sees other games' state.
function joinRoom(room) {
  if (!room) return () => {};
  const key = String(room);
  rooms.add(key);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', room: key }));
  else connectWs();
  return () => {
    rooms.delete(key);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'unsubscribe', room: key }));
  };
}

// ── Entities ─────────────────────────────────────────────────────────────────

function makeEntity(type) {
  const base = `/api/entities/${type}`;
  return {
    list: (sort, limit) => {
      const params = new URLSearchParams();
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(limit));
      return request(`${base}?${params}`);
    },
    filter: (query, sort, limit) => {
      const params = new URLSearchParams();
      if (query) params.set('filter', JSON.stringify(query));
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(limit));
      return request(`${base}?${params}`);
    },
    get: async (id) => {
      const results = await request(`${base}?${new URLSearchParams({ filter: JSON.stringify({ id }) })}`);
      return results[0] || null;
    },
    create: (data) => request(base, { method: 'POST', body: data }),
    update: (id, data) => request(`${base}/${id}`, { method: 'PATCH', body: data }),
    delete: (id) => request(`${base}/${id}`, { method: 'DELETE' }),
    deleteMany: (filter) => request(`${base}/delete-many`, { method: 'POST', body: { filter } }),
    subscribe: (cb) => subscribe(type, cb),
  };
}

// ── Public client ────────────────────────────────────────────────────────────

export const base44 = {
  auth: {
    // Server-resolved identity ({id, email, full_name}) — pages use this to
    // key stats by email. Sign-in/out/reset are handled by Clerk's UI.
    me: () => request('/api/auth/me'),
  },

  entities: {
    Round: makeEntity('Round'),
    UserStats: makeEntity('UserStats'),
    GameSession: makeEntity('GameSession'),
    LeaderboardEntry: makeEntity('LeaderboardEntry'),
    HelpContent: makeEntity('HelpContent'),
  },

  multiplayer: {
    // buzzed_at is this client's buzz instant on the SERVER's clock — the
    // server arbitrates on it so the earliest real buzz wins regardless of who
    // has the shorter network path (see server/buzz.js).
    buzz: (sessionId, { player_id, team, display_name, buzzed_at }) =>
      request(`/api/sessions/${sessionId}/buzz`, {
        method: 'POST', body: { player_id, team, display_name, buzzed_at },
      }),
    sendChat: (sessionId, { sender_id, sender_name, text }) =>
      request(`/api/sessions/${sessionId}/chat`, {
        method: 'POST', body: { sender_id, sender_name, text },
      }),
    answer: (sessionId, body) =>
      request(`/api/sessions/${sessionId}/answer`, { method: 'POST', body }),
    // Question transitions — the server stamps the reading clock.
    start: (sessionId) =>
      request(`/api/sessions/${sessionId}/advance`, { method: 'POST', body: { action: 'start' } }),
    next: (sessionId, { next_index, keep_bonus_owner = false, finished = false }) =>
      request(`/api/sessions/${sessionId}/advance`, {
        method: 'POST', body: { action: 'next', next_index, keep_bonus_owner, finished },
      }),
    dead: (sessionId, { is_bonus = false } = {}) =>
      request(`/api/sessions/${sessionId}/advance`, {
        method: 'POST', body: { action: 'dead', is_bonus },
      }),
    returnToLobby: (sessionId, { round_id = '', game_type = null, reset_scores = true } = {}) =>
      request(`/api/sessions/${sessionId}/advance`, {
        method: 'POST', body: { action: 'lobby', round_id, game_type, reset_scores },
      }),
    leave: (sessionId, { player_id }) =>
      request(`/api/sessions/${sessionId}/leave`, { method: 'POST', body: { player_id } }),
    // The packets this room plays — including a host's private ones, which
    // aren't in other players' libraries.
    rounds: (sessionId) => request(`/api/sessions/${sessionId}/rounds`),
    // Unload-safe leave: a normal fetch is cancelled when the tab closes.
    leaveBeacon: (sessionId, { player_id }) => {
      if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
      const blob = new Blob([JSON.stringify({ player_id })], { type: 'application/json' });
      return navigator.sendBeacon(`/api/sessions/${sessionId}/leave`, blob);
    },
    joinRoom,
  },

  stats: {
    summary: () => request('/api/stats/summary'),
  },

  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const params = new URLSearchParams({ filename: file.name });
        return request(`/api/upload?${params}`, { method: 'POST', body: file, raw: true });
      },
    },
  },
};
