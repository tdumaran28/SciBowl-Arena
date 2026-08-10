// Custom Next.js server: adds the WebSocket realtime channel (/ws) and static
// serving of uploaded packets (/uploads/*) — two things Next route handlers
// can't do. Run with `node server.js` (dev) or NODE_ENV=production (prod,
// after `next build`).
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import nextEnv from '@next/env'; // CJS module — no named ESM exports
import { verifyToken } from '@clerk/backend';
import { startKeepWarm } from './server/keepwarm.js';

const dev = process.env.NODE_ENV !== 'production';
nextEnv.loadEnvConfig(process.cwd(), dev);

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(process.cwd(), 'server', 'uploads');

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
};

const app = next({ dev });
const handle = app.getRequestHandler();

// prepare() prints nothing while it loads Next's module graph, which can take
// minutes on machines with on-access antivirus scanning. Say something first so
// a slow start isn't mistaken for a hang.
console.log(`Starting Next.js (${dev ? 'development' : 'production'})…`);
const prepareStart = Date.now();
await app.prepare();
console.log(`Next.js ready in ${((Date.now() - prepareStart) / 1000).toFixed(1)}s`);

const server = createServer((req, res) => {
  // Serve uploaded packet files directly
  if (req.url?.startsWith('/uploads/')) {
    const name = path.basename(decodeURIComponent(req.url.split('?')[0]));
    const file = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404).end('Not found');
    }
    return;
  }
  handle(req, res);
});

// ── WebSocket realtime (entity update push) ──────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws') {
    // Let Next handle its own upgrades (HMR websocket in dev)
    if (!dev) socket.destroy();
    return;
  }
  const token = searchParams.get('token');
  let userId = null;
  if (token && process.env.CLERK_SECRET_KEY) {
    try {
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      userId = payload?.sub || null;
    } catch { /* invalid token */ }
  }
  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true;
    ws.userId = userId;
    // Rooms this socket is subscribed to. Until a client subscribes it
    // receives only unaddressed broadcasts — never another game's traffic.
    ws.rooms = new Set();
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg = null;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg?.type === 'subscribe' && msg.room) ws.rooms.add(String(msg.room));
      else if (msg?.type === 'unsubscribe' && msg.room) ws.rooms.delete(String(msg.room));
    });
    ws.on('error', () => {});
  });
});

const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(pingInterval));

// Route handlers (compiled in a separate module graph by Next) reach the
// socket server through this global — see server/realtime.js.
//
// A frame carrying a `room` goes only to sockets subscribed to it: match
// traffic stays inside its own game instead of fanning out to every signed-in
// user (which was both O(connections) per buzz and a leak of other rooms'
// state, chat included).
globalThis.__scibowlBroadcast = (frame) => {
  const { room, ...payload } = frame || {};
  const msg = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (room && !ws.rooms?.has(String(room))) continue;
    ws.send(msg);
  }
};

// Keep a free-tier instance from spinning down out from under a live match.
// Off unless KEEP_WARM_URL / RENDER_EXTERNAL_URL is set — see server/keepwarm.js.
// "Active" means at least one player has a realtime socket open, which is true
// for everyone sitting in a room or playing.
startKeepWarm({ isActive: () => wss.clients.size > 0 });

server.listen(PORT, () => {
  console.log(`SciBowl Arena (Next.js) listening on http://localhost:${PORT}`);
});
