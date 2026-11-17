import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createGameServer, resolveStaticPath } from '../server/index.js';
import { GameState, PHASE } from '../src/game/GameState.js';
import { chooseMove } from '../src/game/ai.js';
import { seeded } from './helpers.js';

// These tests start the real server on a free port and talk to it with real WebSockets.

let tmp;
let staticDir;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ludo-server-test-'));
  staticDir = path.join(tmp, 'site');
  mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Ludo</title>');
  writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log("hi")');
  writeFileSync(path.join(tmp, 'secret.txt'), 'TOP SECRET');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const servers = [];
const clients = [];
async function start(options = {}) {
  const server = await createGameServer({ port: 0, host: '127.0.0.1', staticDir, heartbeatMs: 60_000, ...options });
  servers.push(server);
  return server;
}
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  for (const s of servers.splice(0)) await s.close();
});

class Client {
  constructor(port, { headers, pathname = '/ws' } = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, { headers });
    this.messages = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => !w.try());
    });
    this.ws.on('error', () => {});
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    });
    clients.push(this);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  // Resolves with the first not-yet-consumed message matching `match`.
  next(match, timeoutMs = 4000) {
    const test = typeof match === 'string' ? (m) => m.t === match : match;
    return new Promise((resolve, reject) => {
      const waiter = {
        try: () => {
          const i = this.messages.findIndex(test);
          if (i < 0) return false;
          resolve(this.messages.splice(i, 1)[0]);
          clearTimeout(timer);
          return true;
        },
      };
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${typeof match === 'string' ? match : 'message'}; got ${this.messages.map((m) => m.t)}`)), timeoutMs);
      if (!waiter.try()) this.waiters.push(waiter);
    });
  }
}
const connect = async (server, options) => {
  const c = new Client(server.port, options);
  await c.opened;
  return c;
};
const httpGet = (server, rawPath, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path: rawPath, method }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

describe('static files and health', () => {
  it('serves the built game with correct types and caching', async () => {
    const server = await start();
    const page = await httpGet(server, '/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.body).toContain('<title>Ludo</title>');
    const asset = await httpGet(server, '/assets/app-abc123.js');
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toMatch(/immutable/);
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
  });

  it('reports health', async () => {
    const server = await start();
    const r = await httpGet(server, '/health');
    expect(JSON.parse(r.body)).toEqual({ ok: true, connections: 0, rooms: 0 });
  });

  it('returns 404 for missing files, 405 for other methods, and supports HEAD', async () => {
    const server = await start();
    expect((await httpGet(server, '/nope.js')).status).toBe(404);
    expect((await httpGet(server, '/', 'POST')).status).toBe(405);
    const head = await httpGet(server, '/', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('never serves files outside the static folder', async () => {
    const server = await start();
    for (const bad of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt', '/%2e%2e%2f%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/%00', '//..//secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt']) {
      const r = await httpGet(server, bad);
      expect(r.body, bad).not.toContain('TOP SECRET');
      expect([400, 404], bad).toContain(r.status);
    }
  });

  it('resolveStaticPath confines every path to the root', () => {
    const root = path.resolve('/srv/site');
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveStaticPath(root, '/a/b.js?x=1')).toBe(path.join(root, 'a', 'b.js'));
    // Escapes are either refused outright or clamped inside the root: never a path outside it.
    for (const bad of ['/../x', '/a/../../x', '/%2e%2e/x', '/%2e%2e%2f%2e%2e%2fx', '//../x']) {
      const resolved = resolveStaticPath(root, bad);
      expect(resolved === null || resolved.startsWith(root + path.sep), bad).toBe(true);
    }
    for (const refused of ['/a\\..\\x', '/x\0', '/%', '/%00']) expect(resolveStaticPath(root, refused), refused).toBeNull();
  });
});

describe('WebSocket connections', () => {
  it('accepts /ws and rejects other paths', async () => {
    const server = await start();
    await connect(server);
    const other = new Client(server.port, { pathname: '/other' });
    await expect(other.opened).rejects.toMatchObject({ status: 404 });
  });

  it('can restrict which origins may connect', async () => {
    const server = await start({ allowedOrigins: ['https://play.example.com'] });
    await connect(server, { headers: { Origin: 'https://play.example.com' } });
    const bad = new Client(server.port, { headers: { Origin: 'https://evil.example.com' } });
    await expect(bad.opened).rejects.toMatchObject({ status: 403 });
    const none = new Client(server.port);
    await expect(none.opened).rejects.toMatchObject({ status: 403 });
  });

  it('limits connections per address', async () => {
    const server = await start({ maxConnectionsPerIp: 2 });
    await connect(server);
    await connect(server);
    const third = new Client(server.port);
    await expect(third.opened).rejects.toMatchObject({ status: 429 });
  });

  it('limits the total number of connections', async () => {
    const server = await start({ maxConnections: 1 });
    await connect(server);
    const second = new Client(server.port);
    await expect(second.opened).rejects.toMatchObject({ status: 503 });
  });

  it('frees a connection slot when a client disconnects', async () => {
    const server = await start({ maxConnectionsPerIp: 1 });
    const first = await connect(server);
    first.ws.close();
    await first.closed;
    await new Promise((r) => setTimeout(r, 50));
    await connect(server);
    expect(server.stats().connections).toBe(1);
  });

  it('answers hostile input with errors and keeps the connection and the server alive', async () => {
    const server = await start();
    const c = await connect(server);
    c.ws.send('not json at all');
    expect((await c.next('error')).code).toBe('bad_message');
    c.ws.send(JSON.stringify({ t: 'definitely-not-a-message' }));
    expect((await c.next('error')).code).toBe('bad_message');
    c.ws.send(JSON.stringify({ t: 'move', index: 99 }));
    expect((await c.next('error')).code).toBe('bad_message');
    c.ws.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    expect((await c.next('error')).code).toBe('bad_message');
    c.send({ t: 'roll' });
    expect((await c.next('error')).code).toBe('no_room');
    c.send({ t: 'ping' });
    expect((await c.next('pong')).seq).toBeNull(); // still working after all that
  });

  it('closes a connection that sends an oversized message', async () => {
    const server = await start({ maxPayload: 512 });
    const c = await connect(server);
    c.ws.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(2000) }));
    expect(await c.closed).toBe(1009);
    const other = await connect(server);
    other.send({ t: 'ping' });
    await other.next('pong'); // other clients are unaffected
  });

  it('closes a connection that floods the server', async () => {
    const server = await start({ messagesPerSecond: 5, messageBurst: 10 });
    const c = await connect(server);
    for (let i = 0; i < 100; i++) c.send({ t: 'ping' });
    expect(await c.closed).toBe(1008);
  });
});

describe('online games over real WebSockets', () => {
  it('lets two people create, join, start and play a whole game; their replicas match the server', async () => {
    // A test client plays hundreds of moves in a few seconds, far faster than a person; lift the flood limit for it.
    const server = await start({ messagesPerSecond: 5000, messageBurst: 5000 });
    const host = await connect(server);
    host.send({ t: 'create', seats: 2 });
    const hostJoined = await host.next('joined');
    expect(hostJoined.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);

    const guest = await connect(server);
    guest.send({ t: 'join', code: hostJoined.code.toLowerCase() }); // codes are case-insensitive
    const guestJoined = await guest.next('joined');
    expect(guestJoined.color).toBe('green');
    expect((await host.next((m) => m.t === 'room' && m.room.seats.length === 2)).room.seats[1].color).toBe('green');

    host.send({ t: 'start' });
    const hostStart = await host.next('started');
    await guest.next('started');

    // Each person keeps a replica by applying the events, and plays their own turns.
    const rng = seeded(77);
    const replicas = new Map([
      [host, { color: 'red', state: GameState.fromSnapshot(hostStart.snapshot) }],
      [guest, { color: 'green', state: GameState.fromSnapshot(hostStart.snapshot) }],
    ]);
    const roll = (value) => () => (value - 1) / 6 + 0.01;
    const apply = (state, m) => {
      if (m.t === 'rolled') state.rollDice(roll(m.value));
      else if (m.t === 'moved') state.moveToken(m.index);
      else if (m.t === 'turn') state.endTurn();
    };

    let winner = null;
    for (let step = 0; step < 4000 && !winner; step++) {
      const mover = [...replicas.keys()].find((c) => replicas.get(c).color === [...replicas.values()][0].state.currentPlayer);
      const { state } = replicas.get(mover);
      if (state.phase === PHASE.ROLL) mover.send({ t: 'roll' });
      else if (state.phase === PHASE.MOVE) mover.send({ t: 'move', index: chooseMove(state, 'normal', rng) });
      // Wait for the server's next event and apply it to both replicas.
      const event = await mover.next((m) => ['rolled', 'moved', 'turn'].includes(m.t));
      const other = [...replicas.keys()].find((c) => c !== mover);
      const same = await other.next((m) => m.seq === event.seq && m.t === event.t);
      expect(same).toEqual(event);
      for (const r of replicas.values()) apply(r.state, event);
      if (event.winner) winner = event.winner;
    }
    expect(winner).toBeTruthy();

    // Ask the server for its view and compare.
    host.send({ t: 'sync' });
    const snap = await host.next('snapshot');
    for (const r of replicas.values()) expect(r.state.snapshot()).toEqual(snap.snapshot);
  }, 30_000);

  it('lets a person come back with their token after the connection drops', async () => {
    const server = await start();
    const host = await connect(server);
    host.send({ t: 'create', seats: 2 });
    const { code, token } = await host.next('joined');
    const guest = await connect(server);
    guest.send({ t: 'join', code });
    await guest.next('joined');
    host.send({ t: 'start' });
    await host.next('started');

    host.ws.terminate();
    await host.closed;
    expect((await guest.next((m) => m.t === 'room' && m.room.seats[0].connected === false)).room.seats[0].connected).toBe(false);

    const back = await connect(server);
    back.send({ t: 'rejoin', code, token });
    const joined = await back.next('joined');
    expect(joined).toMatchObject({ code, color: 'red', token });
    expect((await back.next('snapshot')).snapshot.players).toEqual(['red', 'green']);
    await guest.next((m) => m.t === 'room' && m.room.seats[0].connected === true);
  });

  it('refuses a rejoin with a guessed token and does not reveal the real one', async () => {
    const server = await start();
    const host = await connect(server);
    host.send({ t: 'create', seats: 2 });
    const { code, token } = await host.next('joined');
    const thief = await connect(server);
    thief.send({ t: 'rejoin', code, token: 'AAAAAAAAAAAAAAAAAAAAAAAA' });
    expect((await thief.next('error')).code).toBe('bad_token');
    expect(JSON.stringify(thief.messages)).not.toContain(token);
  });

  it('keeps rooms separate', async () => {
    const server = await start();
    const a = await connect(server);
    const b = await connect(server);
    a.send({ t: 'create', seats: 2 });
    b.send({ t: 'create', seats: 2 });
    const ja = await a.next('joined');
    const jb = await b.next('joined');
    expect(ja.code).not.toBe(jb.code);
    a.send({ t: 'addAi' });
    await a.next((m) => m.t === 'room' && m.room.seats.length === 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(b.messages.filter((m) => m.t === 'room' && m.room.seats.length === 2)).toHaveLength(0);
    expect(server.stats().rooms).toBe(2);
  });

  it('plays computer seats with real pauses (a one-person game against a computer)', async () => {
    const server = await start({ manager: { roomOptions: { config: { aiThinkMs: 20, aiThinkMinMs: null, aiThinkMaxMs: null, aiPickMs: 20, turnTimeoutMs: 100, awayTimeoutMs: 50 } } } });
    const host = await connect(server);
    host.send({ t: 'create', seats: 2 });
    await host.next('joined');
    host.send({ t: 'addAi' });
    await host.next((m) => m.t === 'room' && m.room.seats.length === 2);
    host.send({ t: 'start' });
    await host.next('started');
    // Do nothing: the person times out and the computer plays for them, so the game plays itself.
    const winner = await host.next((m) => m.t === 'moved' && m.winner, 25_000);
    expect(winner.winner).toBeTruthy();
  }, 30_000);

  it('survives a client vanishing in the middle of everything, then shuts down cleanly', async () => {
    const server = await start();
    const a = await connect(server);
    a.send({ t: 'create', seats: 3 });
    await a.next('joined');
    a.ws.terminate();
    await a.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(server.stats().connections).toBe(0);
    await server.close();
    servers.length = 0;
    await expect(fetchAny(server.port)).rejects.toBeTruthy(); // nothing is listening any more
  });
});

const fetchAny = (port) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', timeout: 500 }, resolve);
    req.on('error', reject);
    req.end();
  });
