import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer, DEFAULTS } from './index.js';

// Command-line entry point: `npm run server`.
//   PORT             port to listen on (default 8080)
//   HOST             address to listen on (default 0.0.0.0, all interfaces)
//   STATIC_DIR       folder with the built game (default dist)
//   ALLOWED_ORIGINS  comma-separated origins allowed to open WebSockets (default: any)
//   LOG_LEVEL        debug: also log accepted WebSocket upgrades (refused ones are always logged, with the reason)
//   TRUST_PROXY      1 when the server is only reachable through nginx / Cloudflare: use the address they report per person
//   MAX_CONNECTIONS_PER_IP  connections one address may keep open (default 20)
const port = Number(process.env.PORT ?? DEFAULTS.port);
const host = process.env.HOST ?? DEFAULTS.host;
const staticDir = process.env.STATIC_DIR ?? DEFAULTS.staticDir;
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
for (const origin of allowedOrigins) {
  if (!/^https?:\/\/[^/\s]+\/?$/i.test(origin)) console.warn(`Warning: ALLOWED_ORIGINS entry "${origin}" is not an origin like https://example.com (no path)`);
}
// LOG_LEVEL=debug also logs accepted WebSocket connections (always logs refused ones).
const verbose = (process.env.LOG_LEVEL ?? '').toLowerCase() === 'debug';
const log = (level, message, fields) => {
  if (level === 'info' && !verbose) return;
  console[level === 'warn' ? 'warn' : 'log'](`[${new Date().toISOString()}] ${message} ${JSON.stringify(fields)}`);
};

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

// Optional pacing overrides (milliseconds), mostly for testing: how long a person may take before the computer
// plays for them, how long a computer "thinks" and "picks", and how long a dropped lobby seat is kept.
const config = {};
for (const [env, key] of [['TURN_TIMEOUT_MS', 'turnTimeoutMs'], ['AI_THINK_MS', 'aiThinkMs'], ['AI_PICK_MS', 'aiPickMs'], ['LOBBY_GRACE_MS', 'lobbyGraceMs'], ['AWAY_TIMEOUT_MS', 'awayTimeoutMs'], ['DISCONNECT_GRACE_MS', 'disconnectGraceMs'], ['DISCONNECT_LEAVE_MS', 'disconnectLeaveMs'], ['MATCH_WAIT_MS', 'matchWaitMs']]) {
  if (process.env[env] === undefined) continue;
  const value = Number(process.env[env]);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`Invalid ${env}: ${process.env[env]}`);
    process.exit(1);
  }
  config[key] = value;
}

const trustProxy = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY ?? '').toLowerCase());
const limits = {};
if (process.env.MAX_CONNECTIONS_PER_IP !== undefined) {
  const n = Number(process.env.MAX_CONNECTIONS_PER_IP);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Invalid MAX_CONNECTIONS_PER_IP: ${process.env.MAX_CONNECTIONS_PER_IP}`);
    process.exit(1);
  }
  limits.maxConnectionsPerIp = n;
}

const server = await createGameServer({ port, host, staticDir, allowedOrigins, trustProxy, log, ...limits, manager: { roomOptions: { config } } });

const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i.address}:${server.port}`);
console.log(`Ludo server listening on port ${server.port}`);
console.log(`  This computer:   http://localhost:${server.port}`);
for (const url of lan) console.log(`  On your network: ${url}`);
if (!existsSync(path.resolve(staticDir, 'index.html'))) {
  console.log(`  (No built game found in "${staticDir}": run "npm run build" first to serve the game from here.)`);
}
if (trustProxy) console.log('  Trusting the proxy for each person\'s address (TRUST_PROXY)');
if (allowedOrigins.length) console.log(`  WebSocket origins limited to: ${allowedOrigins.join(', ')}`);

let stopping = false;
const stop = async (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, shutting down`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
