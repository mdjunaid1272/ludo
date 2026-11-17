import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { checkOrigin, clientIp, createGameServer, DEFAULTS, normalizeOrigin } from '../server/index.js';
import { DEFAULT_CONFIG } from '../server/Room.js';
import { perspectiveColors } from '../src/game/perspective.js';

// Real server, real WebSockets: the production behaviours around a reverse proxy, a full room and clean-up.

const servers = [];
const clients = [];
const start = async (options = {}) => {
  const server = await createGameServer({ port: 0, host: '127.0.0.1', staticDir: 'dist', heartbeatMs: 60_000, ...options });
  servers.push(server);
  return server;
};
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  for (const s of servers.splice(0)) await s.close();
});

class Client {
  constructor(port, headers) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    this.messages = [];
    this.ws.on('message', (data) => this.messages.push(JSON.parse(data.toString())));
    this.ws.on('error', () => {});
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('unexpected-response', (_q, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    });
    clients.push(this);
  }

  send(m) {
    this.ws.send(JSON.stringify(m));
  }

  async next(match, ms = 4000) {
    const test = typeof match === 'string' ? (m) => m.t === match : match;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.messages.findIndex(test);
      if (i >= 0) return this.messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out; got ${this.messages.map((m) => m.t)}`);
  }

  last(type) {
    return [...this.messages].reverse().find((m) => m.t === type);
  }
}
const connect = async (server, headers) => {
  const c = new Client(server.port, headers);
  await c.opened;
  return c;
};

describe('behind a reverse proxy (nginx / Cloudflare)', () => {
  const req = (headers, remote = '10.0.0.5') => ({ headers, socket: { remoteAddress: remote } });

  it('counts the proxy\'s address unless told to trust it, and the reported address when told to', () => {
    const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'cf-connecting-ip': '198.51.100.2' };
    expect(clientIp(req(headers), false)).toBe('10.0.0.5');
    expect(clientIp(req(headers), true)).toBe('198.51.100.2'); // Cloudflare's header wins
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), true)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '2001:db8::1' }), true)).toBe('2001:db8::1');
  });

  it('ignores junk in those headers and falls back to the socket address', () => {
    for (const bad of ['', 'not an ip!', '<script>', 'x'.repeat(200)]) expect(clientIp(req({ 'x-forwarded-for': bad }), true)).toBe('10.0.0.5');
    expect(clientIp(req({}), true)).toBe('10.0.0.5');
  });

  it('with trustProxy, people behind one proxy do not share one connection limit', async () => {
    const server = await start({ maxConnectionsPerIp: 1, trustProxy: true });
    await connect(server, { 'X-Forwarded-For': '203.0.113.1' });
    await connect(server, { 'X-Forwarded-For': '203.0.113.2' });
    await expect(connect(server, { 'X-Forwarded-For': '203.0.113.1' })).rejects.toMatchObject({ status: 429 }); // the same person twice
  });

  it('without trustProxy the limit is per socket address, whatever the headers claim (they cannot be used to dodge it)', async () => {
    const server = await start({ maxConnectionsPerIp: 1 });
    await connect(server, { 'X-Forwarded-For': '203.0.113.1' });
    await expect(connect(server, { 'X-Forwarded-For': '203.0.113.2' })).rejects.toMatchObject({ status: 429 });
  });
});

describe('rooms over real sockets', () => {
  const createRoom = async (server, name) => {
    const host = await connect(server);
    host.send({ t: 'create', seats: 4, name });
    const joined = await host.next('joined');
    return { host, joined };
  };

  it('lets four people into one room by its code and turns the fifth away', async () => {
    const server = await start();
    const { host, joined } = await createRoom(server, 'Host_1');
    const guests = [];
    for (const name of ['Ann_2', 'Bob_3', 'Cy_4']) {
      const g = await connect(server);
      g.send({ t: 'join', code: joined.code, name });
      guests.push({ g, joined: await g.next('joined') });
    }
    const fifth = await connect(server);
    fifth.send({ t: 'join', code: joined.code, name: 'Late_5' });
    expect((await fifth.next('error')).code).toBe('room_full');
    const seats = [joined, ...guests.map((x) => x.joined)].map((j) => j.color);
    expect(new Set(seats).size).toBe(4);
    const room = (await host.next((m) => m.t === 'room' && m.room.seats.length === 4)).room;
    expect(room.seats.map((s) => s.name)).toEqual(['Host_1', 'Ann_2', 'Bob_3', 'Cy_4']);
  });

  it('refuses a code that does not exist and a malformed one, with an error the page can show', async () => {
    const server = await start();
    const c = await connect(server);
    c.send({ t: 'join', code: 'BCDF', name: 'Ann_2' });
    expect((await c.next('error')).code).toBe('no_such_room');
    c.send({ t: 'join', code: 'nope' });
    expect((await c.next('error')).code).toBe('bad_message');
  });

  it('matchmaking puts people in one public room (no duplicate rooms), and a person who leaves frees their seat', async () => {
    const server = await start();
    const players = [];
    for (const name of ['Amy_1', 'Ben_2', 'Cat_3']) {
      const c = await connect(server);
      c.send({ t: 'quick', size: 4, color: 'red', name });
      players.push({ c, joined: await c.next('joined') });
    }
    expect(new Set(players.map((p) => p.joined.code)).size).toBe(1);
    expect(server.manager.rooms.size).toBe(1);
    expect(players.every((p) => p.joined.preferred === 'red')).toBe(true); // everybody may ask for the same colour
    expect(new Set(players.map((p) => p.joined.color)).size).toBe(3); // each has their own seat
    const seats = players.map((p) => p.joined.color);
    for (const p of players) expect(perspectiveColors({ seat: p.joined.color, preferred: 'red', seats })[p.joined.color]).toBe('red');
    players[2].c.send({ t: 'leave' });
    await players[0].c.next((m) => m.t === 'room' && m.room.seats.length === 2);
    const again = await connect(server);
    again.send({ t: 'quick', size: 4, name: 'Dan_4' });
    expect((await again.next('joined')).code).toBe(players[0].joined.code);
    expect(server.manager.rooms.size).toBe(1);
  });

  it('removes a room when everybody has left, and keeps separate rooms separate meanwhile', async () => {
    const server = await start();
    const a = await createRoom(server, 'Ann_1');
    const b = await createRoom(server, 'Bob_2');
    expect(a.joined.code).not.toBe(b.joined.code);
    expect(server.manager.rooms.size).toBe(2);
    a.host.send({ t: 'leave' });
    await a.host.next(() => true).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(server.manager.rooms.size).toBe(1);
    b.host.ws.terminate(); // a dropped connection keeps the seat for a while, but the room goes once nobody is left
    b.host.send = () => {};
    const c = await connect(server);
    c.send({ t: 'rejoin', code: b.joined.code, token: b.joined.token });
    await c.next('joined');
    c.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 100));
    expect(server.manager.rooms.size).toBe(0);
  });

  it('puts a person who reconnects back in their own seat, without a second entry', async () => {
    const server = await start();
    const { host, joined } = await createRoom(server, 'Ann_1');
    host.ws.terminate();
    const back = await connect(server);
    back.send({ t: 'rejoin', code: joined.code, token: joined.token });
    const again = await back.next('joined');
    expect(again).toMatchObject({ id: joined.id, color: joined.color, name: 'Ann_1' });
    const room = (await back.next('room')).room;
    expect(room.seats).toHaveLength(1);
  });
});

// The one place the game server itself answers 403: the origin allow-list.
describe('the origin allow-list (the only 403 the game server sends)', () => {
  const PROD = 'https://gametest2.atmegame.com';
  const attempt = (server, headers) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers });
    ws.on('open', () => { resolve({ status: 101 }); ws.terminate(); });
    ws.on('unexpected-response', (_q, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, reject: res.headers['x-ludo-reject'], body }));
    });
    ws.on('error', () => {});
  });

  it('writes an origin one way, whatever capitals, trailing slash or default port it was typed with', () => {
    for (const typed of ['https://gametest2.atmegame.com', 'https://gametest2.atmegame.com/', 'HTTPS://GameTest2.AtmeGame.com', ' https://gametest2.atmegame.com:443 ']) expect(normalizeOrigin(typed), typed).toBe(PROD);
    expect(normalizeOrigin('http://gametest2.atmegame.com')).not.toBe(PROD); // another scheme is another origin
    expect(normalizeOrigin('https://gametest2.atmegame.com:8443')).not.toBe(PROD);
  });

  it('accepts everything with no list, and with a list only the listed origins (and says why otherwise)', () => {
    expect(checkOrigin('https://anything.example', [])).toEqual({ ok: true });
    expect(checkOrigin(undefined, [])).toEqual({ ok: true });
    expect(checkOrigin(PROD, [`${PROD}/`])).toEqual({ ok: true }); // a trailing slash in the setting no longer breaks it
    expect(checkOrigin(PROD, ['https://other.example', PROD])).toEqual({ ok: true });
    expect(checkOrigin('https://evil.example', [PROD])).toMatchObject({ ok: false, reason: expect.stringContaining('not in ALLOWED_ORIGINS') });
    expect(checkOrigin('http://gametest2.atmegame.com', [PROD]).ok).toBe(false);
    expect(checkOrigin('https://gametest2.atmegame.com.evil.example', [PROD]).ok).toBe(false); // not a prefix match
    expect(checkOrigin(undefined, [PROD])).toMatchObject({ ok: false, reason: expect.stringContaining('no Origin header') });
  });

  it('lets the production origin through with HTTP 101, even when the setting was typed with a slash or capitals', async () => {
    for (const setting of [PROD, `${PROD}/`, 'HTTPS://GAMETEST2.ATMEGAME.COM']) {
      const server = await start({ allowedOrigins: [setting] });
      expect((await attempt(server, { Origin: PROD })).status, setting).toBe(101);
    }
  });

  it('still refuses other origins and pages without an Origin header, with 403 and the reason in the header and body', async () => {
    const server = await start({ allowedOrigins: [PROD] });
    const evil = await attempt(server, { Origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.reject).toMatch(/not in ALLOWED_ORIGINS/);
    expect(evil.body).toMatch(/403 Forbidden: origin https:\/\/evil\.example/);
    const none = await attempt(server, {});
    expect(none.status).toBe(403);
    expect(none.reject).toMatch(/no Origin header/);
  });

  it('answers the other refusals with their own status and reason as well', async () => {
    const server = await start();
    const wrong = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/socket`);
      ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode, reject: res.headers['x-ludo-reject'] }));
      ws.on('error', () => {});
    });
    expect(wrong.status).toBe(404);
    expect(wrong.reject).toMatch(/use \/ws/);
  });

  it('logs every upgrade with its path, origin, host and the reason, and never the cookies or other headers', async () => {
    const lines = [];
    const server = await start({ allowedOrigins: [PROD], log: (level, message, fields) => lines.push({ level, message, fields }) });
    await attempt(server, { Origin: PROD, Cookie: 'session=SECRET-COOKIE', Authorization: 'Bearer SECRET-TOKEN' });
    await attempt(server, { Origin: 'https://evil.example', Cookie: 'session=SECRET-COOKIE' });
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn']);
    expect(lines[0].fields).toMatchObject({ path: '/ws', origin: PROD, originCheck: 'passed' });
    expect(lines[1].message).toMatch(/refused \(403\).*not in ALLOWED_ORIGINS/);
    expect(lines[1].fields).toMatchObject({ origin: 'https://evil.example', path: '/ws' });
    expect(lines[1].fields.host).toMatch(/^127\.0\.0\.1:/);
    expect(JSON.stringify(lines)).not.toMatch(/SECRET/);
  });

  it('a legitimate player on the production origin can create and join a room, while another origin cannot', async () => {
    const server = await start({ allowedOrigins: [PROD] });
    const host = await connect(server, { Origin: PROD });
    host.send({ t: 'create', seats: 2, name: 'Ann_1' });
    const joined = await host.next('joined');
    const guest = await connect(server, { Origin: PROD });
    guest.send({ t: 'join', code: joined.code, name: 'Bob_2' });
    expect((await guest.next('joined')).code).toBe(joined.code);
    await expect(connect(server, { Origin: 'https://evil.example' })).rejects.toMatchObject({ status: 403 });
  });
});

// What the server sees when somebody switches their Wi-Fi off: the connection does not close, it just goes silent.
describe('a player whose connection goes silent (Wi-Fi switched off)', () => {
  const silent = (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { autoPong: false }); // never answers the server's pings
    const c = { ws, messages: [] };
    ws.on('message', (d) => c.messages.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
    clients.push(c);
    return new Promise((resolve) => ws.once('open', () => resolve(c)));
  };
  const wait = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  it('is noticed within a few heartbeats, and after the leave time the computer has their seat for good', async () => {
    const server = await start({ heartbeatMs: 100, manager: { roomOptions: { config: { disconnectLeaveMs: 400, disconnectGraceMs: 200, aiThinkMinMs: null, aiThinkMaxMs: null } } } });
    const host = await connect(server);
    host.send({ t: 'create', seats: 2, name: 'Ann_1' });
    const joined = await host.next('joined');
    const wifi = await silent(server.port);
    wifi.ws.send(JSON.stringify({ t: 'join', code: joined.code, name: 'Bob_2' }));
    await wait(() => wifi.messages.some((m) => m.t === 'joined'));
    host.send({ t: 'start' });
    await host.next('started');
    const t0 = Date.now();
    // the silent player is dropped by the server's heartbeat...
    expect(await wait(() => server.stats().connections === 1), 'dropped by the heartbeat').toBe(true);
    const noticed = Date.now() - t0;
    // ...and then counts as having left: the host is told, and the game is over for the one who is left (a 2-player game)
    expect(await wait(() => host.messages.some((m) => m.t === 'left')), 'told that the player left').toBe(true);
    expect(noticed).toBeLessThan(1500);
    const left = host.messages.find((m) => m.t === 'left');
    expect(left).toMatchObject({ over: true, winner: joined.color, rankings: [joined.color, expect.any(String)] });
    const seat = host.messages.findLast((m) => m.t === 'room').room.seats.find((s) => s.name === 'Bob_2');
    expect(seat).toMatchObject({ kind: 'left', status: 'left' }); // nobody took the seat
    // nobody plays for the one who left
    await new Promise((r) => setTimeout(r, 500));
    expect(host.messages.some((m) => (m.t === 'rolled' || m.t === 'moved') && m.player !== joined.color)).toBe(false);
  });

  it('cannot come back to the seat afterwards (their saved token is no longer valid)', async () => {
    const server = await start({ heartbeatMs: 100, manager: { roomOptions: { config: { disconnectLeaveMs: 300 } } } });
    const host = await connect(server);
    host.send({ t: 'create', seats: 2, name: 'Ann_1' });
    const joined = await host.next('joined');
    const wifi = await silent(server.port);
    wifi.ws.send(JSON.stringify({ t: 'join', code: joined.code, name: 'Bob_2' }));
    await wait(() => wifi.messages.some((m) => m.t === 'joined'));
    const bob = wifi.messages.find((m) => m.t === 'joined');
    host.send({ t: 'start' });
    await host.next('started');
    await wait(() => server.stats().connections === 1);
    await new Promise((r) => setTimeout(r, 700));
    const back = await connect(server);
    back.send({ t: 'rejoin', code: joined.code, token: bob.token });
    expect((await back.next('error')).code).toBe('bad_token');
  });
});

describe('the default timings that decide how fast a lost connection is noticed', () => {
  it('notice a silent connection within 10 s and give the seat away 10 s later (not after a minute)', () => {
    expect(DEFAULTS.heartbeatMs).toBeLessThanOrEqual(5000);
    expect(DEFAULT_CONFIG.disconnectLeaveMs).toBeLessThanOrEqual(10_000);
    expect(DEFAULTS.heartbeatMs * 2 + DEFAULT_CONFIG.disconnectLeaveMs).toBeLessThanOrEqual(20_000);
  });
});
