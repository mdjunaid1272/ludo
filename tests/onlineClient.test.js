import { describe, it, expect, vi } from 'vitest';
import { resolveServerUrl, isValidServerUrl } from '../src/online/serverUrl.js';
import { OnlineClient } from '../src/online/OnlineClient.js';

describe('resolveServerUrl', () => {
  const loc = (over) => ({ protocol: 'http:', hostname: 'localhost', port: '', search: '', ...over });

  it('connects back to the page host when the game server served the page', () => {
    expect(resolveServerUrl(loc({ hostname: 'game.example.com', port: '' }))).toBe('ws://game.example.com/ws');
    expect(resolveServerUrl(loc({ hostname: '192.168.1.5', port: '8080' }))).toBe('ws://192.168.1.5:8080/ws');
    expect(resolveServerUrl(loc({ protocol: 'https:', hostname: 'game.example.com', port: '' }))).toBe('wss://game.example.com/ws');
  });

  it('points the Vite dev and preview servers at the game server on port 8080', () => {
    expect(resolveServerUrl(loc({ port: '5173' }))).toBe('ws://localhost:8080/ws');
    expect(resolveServerUrl(loc({ hostname: '192.168.1.5', port: '4173' }))).toBe('ws://192.168.1.5:8080/ws');
    expect(resolveServerUrl(loc({ protocol: 'https:', port: '5173' }))).toBe('wss://localhost:8080/ws');
  });

  it('prefers ?server= over a saved value over the default, and ignores invalid ones', () => {
    expect(resolveServerUrl(loc({ search: '?server=wss://play.example.com/ws' }), 'ws://saved/ws')).toBe('wss://play.example.com/ws');
    expect(resolveServerUrl(loc({ port: '5173' }), 'ws://saved.example.com:9000/ws')).toBe('ws://saved.example.com:9000/ws');
    expect(resolveServerUrl(loc({ port: '5173', search: '?server=http://evil.example.com' }), 'javascript:alert(1)')).toBe('ws://localhost:8080/ws');
  });

  it('only accepts ws:// and wss:// addresses', () => {
    for (const good of ['ws://localhost:8080/ws', 'wss://a.b.c/ws', 'ws://10.0.0.2:1234']) expect(isValidServerUrl(good), good).toBe(true);
    for (const bad of ['', 'http://x', 'https://x', 'javascript:alert(1)', 'ws://', 'localhost:8080', null, undefined, 5, 'ws://' + 'a'.repeat(300)]) {
      expect(isValidServerUrl(bad), String(bad)).toBe(false);
    }
  });
});

// A scriptable WebSocket stand-in.
class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    this.closedByUs = true;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

// Timers the test controls.
const fakeTimers = () => {
  const t = { timeouts: [], intervals: [], cleared: [] };
  t.setTimeout = (fn, ms) => (t.timeouts.push({ fn, ms }), t.timeouts.length);
  t.clearTimeout = (id) => t.cleared.push(id);
  t.setInterval = (fn, ms) => (t.intervals.push({ fn, ms }), t.intervals.length);
  t.clearInterval = (id) => t.cleared.push(`i${id}`);
  return t;
};

const makeClient = (extra = {}) => {
  FakeSocket.instances = [];
  const timers = fakeTimers();
  const client = new OnlineClient({ WebSocketImpl: FakeSocket, timers, connectTimeoutMs: 5000, pingMs: 1000, ...extra });
  return { client, timers, socket: () => FakeSocket.instances.at(-1) };
};

describe('OnlineClient', () => {
  it('connects to the given address and resolves once open', async () => {
    const { client, socket } = makeClient();
    const connecting = client.connect('ws://x/ws');
    expect(socket().url).toBe('ws://x/ws');
    expect(client.connected).toBe(false);
    socket().open();
    await expect(connecting).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });

  it('rejects if the connection fails or times out, and never calls onClose for that', async () => {
    const a = makeClient();
    let closes = 0;
    a.client.onClose = () => closes++;
    const failing = a.client.connect('ws://x/ws');
    a.socket().onerror?.();
    await expect(failing).rejects.toThrow(/connect/i);

    const b = makeClient();
    const slow = b.client.connect('ws://x/ws');
    b.timers.timeouts[0].fn(); // the timeout fires
    await expect(slow).rejects.toThrow(/timed out/i);
    expect(b.client.connected).toBe(false);
    expect(closes).toBe(0);
  });

  it('rejects when the WebSocket cannot even be created', async () => {
    const client = new OnlineClient({ WebSocketImpl: class { constructor() { throw new Error('blocked'); } }, timers: fakeTimers() });
    await expect(client.connect('ws://x/ws')).rejects.toThrow('blocked');
  });

  it('sends JSON only while open', async () => {
    const { client, socket } = makeClient();
    expect(client.send({ t: 'roll' })).toBe(false);
    const connecting = client.connect('ws://x/ws');
    expect(client.send({ t: 'roll' })).toBe(false); // still connecting
    socket().open();
    await connecting;
    expect(client.send({ t: 'move', index: 2 })).toBe(true);
    expect(socket().sent).toEqual([{ t: 'move', index: 2 }]);
  });

  it('delivers parsed messages, and ignores junk and messages without a type', async () => {
    const { client, socket } = makeClient();
    const got = [];
    client.onMessage = (m) => got.push(m);
    const connecting = client.connect('ws://x/ws');
    socket().open();
    await connecting;
    socket().receive({ t: 'room', room: {} });
    socket().receive('not json');
    socket().receive({ nope: 1 });
    socket().receive('null');
    socket().receive({ t: 5 });
    expect(got).toEqual([{ t: 'room', room: {} }]);
  });

  it('reports an unexpected close, but not one it caused itself', async () => {
    const { client, socket } = makeClient();
    const closes = [];
    client.onClose = (info) => closes.push(info);
    const connecting = client.connect('ws://x/ws');
    socket().open();
    await connecting;
    socket().drop(1011);
    expect(closes).toEqual([{ code: 1011, reason: '' }]);
    expect(client.connected).toBe(false);

    const second = client.connect('ws://x/ws');
    socket().open();
    await second;
    client.close();
    expect(closes).toHaveLength(1);
    expect(client.connected).toBe(false);
  });

  it('drop() closes the connection and reports an unexpected close once; with no connection it does nothing', async () => {
    const { client, socket } = makeClient();
    const closes = [];
    client.onClose = (info) => closes.push(info);
    expect(() => client.drop()).not.toThrow();
    const connecting = client.connect('ws://x/ws');
    socket().open();
    await connecting;
    client.drop();
    expect(closes).toEqual([{ code: 0, reason: 'dropped' }]);
    expect(socket().closedByUs).toBe(true);
    expect(client.connected).toBe(false);
    client.drop();
    expect(closes).toHaveLength(1);
  });

  it('pings at the configured interval while connected and stops when closed', async () => {
    const { client, socket, timers } = makeClient();
    const connecting = client.connect('ws://x/ws');
    socket().open();
    await connecting;
    expect(timers.intervals[0].ms).toBe(1000);
    timers.intervals[0].fn();
    expect(socket().sent).toEqual([{ t: 'ping' }]);
    client.close();
    expect(timers.cleared).toContain('i1');
  });

  it('closes the previous connection when connecting again', async () => {
    const { client } = makeClient();
    const first = client.connect('ws://a/ws');
    FakeSocket.instances[0].open();
    await first;
    const second = client.connect('ws://b/ws');
    expect(FakeSocket.instances[0].closedByUs).toBe(true);
    FakeSocket.instances[1].open();
    await second;
    expect(client.connected).toBe(true);
  });
});

describe('noticing a connection that went silent', () => {
  it('drops (and reports a close) when the server has said nothing for too long, instead of looking connected for ever', async () => {
    let clock = 1000;
    const { client, timers, socket } = makeClient({ deadAfterMs: 2500, now: () => clock });
    const closed = vi.fn();
    client.onClose = closed;
    const connecting = client.connect('ws://x/ws');
    socket().open();
    await connecting;
    const tick = timers.intervals.at(-1).fn;
    clock += 1000; tick(); // 1 s of silence: fine, pings
    expect(client.connected).toBe(true);
    clock += 1000; socket().receive({ t: 'pong' }); // the server answered: the silence starts again
    clock += 2000; tick();
    expect(client.connected).toBe(true);
    clock += 1000; tick(); // 3 s since the last word: lost
    expect(client.connected).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'dropped' }));
  });
});