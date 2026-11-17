import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { parseClientMessage } from '../src/online/protocol.js';
import { RoomManager } from './RoomManager.js';

// The game server: serves the built game (dist/) over HTTP and runs online rooms over WebSocket at /ws.
// One process, one port, so the same address works for the page and the connection.

export const DEFAULTS = Object.freeze({
  port: 8080,
  host: '0.0.0.0',
  staticDir: 'dist',
  maxConnections: 1000,
  maxConnectionsPerIp: 20,
  maxPayload: 4096, // bytes per WebSocket message
  heartbeatMs: 5_000, // the server pings every connection this often; one that has not answered by the next ping is dropped, so a
  //                     phone whose Wi-Fi was switched off is noticed within 5-10 seconds (it never closes the connection itself)
  messagesPerSecond: 20, // sustained message rate per connection...
  messageBurst: 40, // ...with this much allowed in a burst
  allowedOrigins: [], // if not empty, only these Origin headers may open a WebSocket
  log: () => {}, // called with (level, message, fields) for upgrade requests: 'info' for accepted ones, 'warn' for rejected ones
  trustProxy: false, // behind nginx / Cloudflare: take each person's address from the proxy's headers (see clientIp)
});

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// An origin as browsers send it ("https://host" or "https://host:port", no path), written one way so that harmless differences in
// how it was typed into ALLOWED_ORIGINS (capitals, a trailing "/") do not make a legitimate page fail with a 403.
export function normalizeOrigin(value) {
  const text = String(value ?? '').trim();
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin; // lower-cases, drops the path and a default port
  } catch {
    // not a URL: compared as plain text below
  }
  return text.replace(/\/+$/, '').toLowerCase();
}

// Decides whether a WebSocket may be opened from `origin`. Returns { ok: true } or { ok: false, reason }. With no allow-list every
// origin is accepted (the default); with one, the browser's Origin header must be on it. This is the only place the game
// server itself ever answers 403.
export function checkOrigin(origin, allowed) {
  if (!allowed || allowed.length === 0) return { ok: true };
  if (!origin) return { ok: false, reason: 'no Origin header (browsers always send one; this is not a browser page)' };
  const wanted = normalizeOrigin(origin);
  if (allowed.some((a) => normalizeOrigin(a) === wanted)) return { ok: true };
  return { ok: false, reason: `origin ${wanted} is not in ALLOWED_ORIGINS (${allowed.map(normalizeOrigin).join(', ')})` };
}

// The address a connection counts as for the per-address limit. Directly on the internet that is the socket's address. Behind a
// reverse proxy every connection comes from the proxy, so with `trustProxy` the address the proxy reports is used instead
// (Cloudflare's CF-Connecting-IP, else the first X-Forwarded-For entry). Only turn trustProxy on when the server can be reached
// through the proxy alone: otherwise anybody could claim any address.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const header = req.headers['cf-connecting-ip'] ?? String(req.headers['x-forwarded-for'] ?? '').split(',')[0];
    const ip = String(header ?? '').trim();
    if (ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

// Maps a URL path to a file inside `root`, or null if it would escape it. Rejects "..", encoded tricks and
// null bytes. A path ending in "/" (or empty) means index.html.
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.endsWith('/')) decoded += 'index.html';
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

async function serveFile(root, req, res) {
  const target = resolveStaticPath(root, req.url ?? '/');
  if (!target) return send(res, 400, 'Bad request');
  try {
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, 'Not found');
    const body = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      // Hashed build assets never change; the page itself must always be re-checked.
      'Cache-Control': target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

// Starts the server. Resolves with { port, manager, stats(), close() } once it is listening.
export async function createGameServer(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const manager = new RoomManager(opts.manager);
  manager.startSweeping();
  const staticRoot = path.resolve(opts.staticDir);

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ...stats() }));
    }
    return serveFile(staticRoot, req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxPayload });
  const perIp = new Map();
  let connections = 0;
  const stats = () => ({ connections, rooms: manager.rooms.size });

  // A refused upgrade says who refused it and why (header X-Ludo-Reject, and the body): a 403 from the game server can then be told
  // apart from one from nginx or Cloudflare, which never send these.
  const reject = (socket, status, text, why = text) => {
    const body = `${status} ${text}: ${why}\n`;
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nX-Ludo-Reject: ${why.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)}\r\n\r\n${body}`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    const ip = clientIp(req, opts.trustProxy);
    // Safe to log: the path, the Origin and Host headers and the address. Never cookies, tokens or anything a player sent.
    const fields = { path: pathname, origin: req.headers.origin ?? '(none)', host: req.headers.host ?? '(none)', ip };
    const refuse = (status, text, why) => {
      opts.log('warn', `WebSocket upgrade refused (${status}): ${why}`, fields);
      reject(socket, status, text, why);
    };
    if (pathname !== '/ws') return refuse(404, 'Not Found', `no WebSocket endpoint at ${pathname} (use /ws)`);
    const origin = checkOrigin(req.headers.origin, opts.allowedOrigins);
    if (!origin.ok) return refuse(403, 'Forbidden', origin.reason);
    if (connections >= opts.maxConnections) return refuse(503, 'Service Unavailable', 'too many connections on the server');
    if ((perIp.get(ip) ?? 0) >= opts.maxConnectionsPerIp) return refuse(429, 'Too Many Requests', `too many connections from ${ip}`);
    opts.log('info', 'WebSocket upgrade accepted', { ...fields, originCheck: opts.allowedOrigins.length ? 'passed' : 'not required' });
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, ip));
  });

  wss.on('connection', (ws, ip) => {
    connections += 1;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    const conn = {
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      close: () => ws.close(4000, 'replaced'),
    };
    const session = manager.newSession(conn);

    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, opts.heartbeatMs);

    // A token bucket stops one connection flooding the server.
    const bucket = { tokens: opts.messageBurst, at: Date.now() };
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      bucket.tokens = Math.min(opts.messageBurst, bucket.tokens + ((now - bucket.at) / 1000) * opts.messagesPerSecond);
      bucket.at = now;
      if (bucket.tokens < 1) return ws.close(1008, 'rate limit');
      bucket.tokens -= 1;

      if (isBinary) return conn.send({ t: 'error', code: 'bad_message', message: 'Messages must be text.' });
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return conn.send({ t: 'error', code: 'bad_message', message: parsed.error });
      try {
        manager.route(session, parsed.msg);
      } catch (error) {
        // A bug must not take the whole server (and every other game) down.
        console.error('Error handling message', parsed.msg.t, error);
        conn.send({ t: 'error', code: 'internal', message: 'Something went wrong on the server.' });
      }
    });

    ws.on('error', () => {}); // the 'close' event follows and does the cleanup
    ws.on('close', () => {
      clearInterval(heartbeat);
      connections -= 1;
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      manager.closed(session);
    });
  });

  await new Promise((resolve, reject2) => {
    server.once('error', reject2);
    server.listen(opts.port, opts.host, resolve);
  });

  return {
    port: server.address().port,
    manager,
    stats,
    close: () =>
      new Promise((resolve) => {
        manager.close();
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
