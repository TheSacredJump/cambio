import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameError } from '../shared/game.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Room } from '../shared/room.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist');
const ROOM_IDLE_MS = 30 * 60_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const rooms = new Map<string, Room>();
const schedule = (ms: number, fn: () => void) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(code)) return code;
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain' }).end('Run `npm run build` first, or use `npm run dev`.');
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let memberId: string | null = null;
  const send = (msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      if (msg.t === 'ping') return send({ t: 'pong' });
      if (msg.t === 'create' || msg.t === 'join') {
        if (room && memberId) room.disconnect(memberId, send);
        const token = String(msg.token ?? '').slice(0, 64);
        if (!token) throw new GameError('Missing player token.');
        if (msg.t === 'create') {
          room = new Room(newCode(), schedule);
          rooms.set(room.code, room);
        } else {
          const code = String(msg.code ?? '').toUpperCase().trim();
          room = rooms.get(code) ?? null;
          if (!room) throw Object.assign(new GameError(`There’s no table called ${code || '…'}. Check the code and try again.`), { fatal: true });
        }
        const member = room.join(String(msg.name ?? ''), token);
        memberId = member.id;
        room.connect(memberId, send);
        return;
      }
      if (!room || !memberId) throw new GameError('Join a table first.');
      room.handle(memberId, msg);
    } catch (err) {
      if (err instanceof GameError) {
        send({ t: 'error', msg: err.message, fatal: (err as GameError & { fatal?: boolean }).fatal, quiet: err.quiet });
      } else {
        console.error(err);
        send({ t: 'error', msg: 'Something went wrong on the server.' });
      }
    }
  });

  ws.on('close', () => {
    if (room && memberId) room.disconnect(memberId, send);
  });
});

// Clear out tables nobody has touched in a while.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.connectedHumans === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
      room.dispose();
      rooms.delete(code);
    }
  }
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`\n  Cambio is open.`);
  console.log(`  This computer:  http://localhost:${PORT}`);
  if (lan) console.log(`  Same Wi-Fi:     http://${lan}:${PORT}`);
  console.log('');
});
