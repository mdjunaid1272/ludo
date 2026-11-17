import { describe, it, expect, vi } from 'vitest';
import { OnlineSession, createSessionStore } from '../src/online/OnlineSession.js';
import { makeState } from './helpers.js';

const TOKEN = 'abcdefghijklmnopqrstuvwx';
const snapshot = () => makeState({ players: ['red', 'green'] }).snapshot();

// A scriptable stand-in for OnlineClient.
class FakeClient {
  static all = [];
  static plan = []; // outcomes for successive connect() calls: true = succeeds, false = fails
  constructor() {
    this.sent = [];
    this.connected = false;
    this.closedByUs = false;
    this.onMessage = () => {};
    this.onClose = () => {};
    FakeClient.all.push(this);
  }

  async connect(url) {
    this.url = url;
    const ok = FakeClient.plan.length ? FakeClient.plan.shift() : true;
    if (!ok) throw new Error('refused');
    this.connected = true;
  }

  send(message) {
    if (!this.connected) return false;
    this.sent.push(message);
    return true;
  }

  close() {
    this.connected = false;
    this.closedByUs = true;
  }

  receive(message) {
    this.onMessage(message);
  }

  dropped() {
    this.connected = false;
    this.onClose({ code: 1006 });
  }

  drop() {
    this.dropCalls = (this.dropCalls ?? 0) + 1;
    this.dropped();
  }
}

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
};

// Timers that only run when told to, recording the delays asked for.
const fakeTimers = () => {
  const t = { pending: [], delays: [], cleared: [] };
  t.setTimeout = (fn, ms) => {
    t.delays.push(ms);
    t.pending.push(fn);
    return t.pending.length;
  };
  t.runLast = () => t.pending.pop()?.();
  t.clearTimeout = (id) => t.cleared.push(id);
  t.runNext = async () => {
    const fn = t.pending.shift();
    fn?.();
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  return t;
};

function setup() {
  FakeClient.all = [];
  FakeClient.plan = [];
  const storage = memoryStorage();
  const timers = fakeTimers();
  const store = createSessionStore(() => storage);
  const nameBox = { current: 'Tester_1' };
  const session = new OnlineSession({ createClient: () => new FakeClient(), store, timers, getUrl: () => 'ws://test/ws', getName: () => nameBox.current });
  const events = [];
  for (const e of ['status', 'joined', 'room', 'lobby', 'started', 'error', 'left']) session.on(e, (p) => events.push([e, p]));
  return { session, storage, timers, events, nameBox, client: () => FakeClient.all.at(-1), names: () => events.map(([e]) => e) };
}
const connected = async (s) => {
  await s.session.connect();
  return s.client();
};
const joined = (s, over = {}) => s.client().receive({ t: 'joined', code: 'BCDF', token: TOKEN, color: 'red', ...over });

describe('session store', () => {
  it('saves and loads the seat, and forgets it', () => {
    const storage = memoryStorage();
    const store = createSessionStore(() => storage);
    expect(store.load()).toBeNull();
    store.save('BCDF', TOKEN);
    expect(store.load()).toEqual({ code: 'BCDF', token: TOKEN });
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('forgets a seat after 12 hours, and ignores corrupt or invalid saved data', () => {
    const storage = memoryStorage();
    let now = 1_000_000;
    const store = createSessionStore(() => storage, () => now);
    store.save('BCDF', TOKEN);
    now += 12 * 3600 * 1000 - 1;
    expect(store.load()).not.toBeNull();
    now += 2;
    expect(store.load()).toBeNull();
    for (const bad of ['{not json', 'null', '{"code":"AEIO","token":"' + TOKEN + '","at":1}', '{"code":"BCDF","token":"short","at":1}', '{"code":"BCDF","token":"' + TOKEN + '"}']) {
      storage.setItem('ludo.online.session.v1', bad);
      expect(store.load(), bad).toBeNull();
    }
  });

  it('works when storage is missing or throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    for (const get of [() => undefined, boom, () => ({ getItem: boom, setItem: boom, removeItem: boom })]) {
      const store = createSessionStore(get);
      expect(store.load()).toBeNull();
      expect(() => store.save('BCDF', TOKEN)).not.toThrow();
      expect(() => store.clear()).not.toThrow();
    }
  });
});

describe('connecting and sending', () => {
  it('connects to the configured address and reports status', async () => {
    const s = setup();
    await s.session.connect();
    expect(s.client().url).toBe('ws://test/ws');
    expect(s.events.filter(([e]) => e === 'status').map(([, p]) => p.status)).toEqual(['connecting', 'connected']);
  });

  it('reports failure and rejects when it cannot connect', async () => {
    const s = setup();
    FakeClient.plan = [false];
    await expect(s.session.connect()).rejects.toThrow('refused');
    expect(s.session.status).toBe('failed');
  });

  it('sends create, join (normalising the code), rejoin and leave', async () => {
    const s = setup();
    const c = await connected(s);
    s.session.create({ seats: 3, difficulty: 'hard' });
    s.session.join(' bcdf ');
    s.storage.setItem('ludo.online.session.v1', JSON.stringify({ code: 'GHJK', token: TOKEN, at: Date.now() }));
    expect(s.session.rejoin()).toBe(true);
    s.session.leave();
    expect(c.sent).toEqual([
      { t: 'create', seats: 3, difficulty: 'hard', name: 'Tester_1' },
      { t: 'join', code: 'BCDF', name: 'Tester_1' },
      { t: 'rejoin', code: 'GHJK', token: TOKEN },
      { t: 'leave' },
    ]);
  });

  it('sends the person\'s name when it joins a public match (and none when there is none), but never on rejoin', async () => {
    const s = setup();
    const c = await connected(s);
    s.session.quick(4, 'red');
    s.nameBox.current = 'Other_9';
    s.session.quick(4);
    s.nameBox.current = null;
    s.session.quick(4);
    expect(c.sent).toEqual([
      { t: 'quick', size: 4, color: 'red', name: 'Tester_1' },
      { t: 'quick', size: 4, name: 'Other_9' },
      { t: 'quick', size: 4 },
    ]);
  });

  it('remembers the public player id the server gave it, and forgets it on leaving', async () => {
    const s = setup();
    await connected(s);
    joined(s, { preferred: 'red', id: 'a1b2c3d4e5f6', name: 'Tester_1' });
    expect(s.session.id).toBe('a1b2c3d4e5f6');
    s.session.leave();
    expect(s.session.id).toBeNull();
  });

  it('cannot rejoin without a saved seat, and does not send while disconnected', async () => {
    const s = setup();
    expect(s.session.send({ t: 'roll' })).toBe(false);
    await connected(s);
    expect(s.session.rejoin()).toBe(false);
  });
});

describe('messages', () => {
  it('remembers the seat when joined, and tells the screens', async () => {
    const s = setup();
    await connected(s);
    joined(s, { color: 'blue' });
    expect(s.session).toMatchObject({ code: 'BCDF', token: TOKEN, color: 'blue', inRoom: true });
    expect(s.session.savedSeat()).toEqual({ code: 'BCDF', token: TOKEN });
    expect(s.events.find(([e]) => e === 'joined')[1]).toEqual({ code: 'BCDF', color: 'blue' });
  });

  it('passes room updates on', async () => {
    const s = setup();
    await connected(s);
    s.client().receive({ t: 'room', room: { phase: 'lobby', seats: [] } });
    expect(s.session.room.phase).toBe('lobby');
    expect(s.names()).toContain('room');
  });

  it('creates the live game when it starts, forwards game events to it, and checks the heartbeat sequence', async () => {
    const s = setup();
    await connected(s);
    joined(s);
    s.client().receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    const game = s.session.game;
    expect(game).not.toBeNull();
    expect(game.myColor).toBe('red');
    expect(s.events.find(([e]) => e === 'started')[1].game).toBe(game);
    const handle = vi.spyOn(game, 'handle');
    const check = vi.spyOn(game, 'checkSeq');
    s.client().receive({ t: 'rolled', seq: 1 });
    s.client().receive({ t: 'moved', seq: 2 });
    s.client().receive({ t: 'turn', seq: 3 });
    expect(handle).toHaveBeenCalledTimes(3);
    s.client().receive({ t: 'pong', seq: 3 });
    expect(check).toHaveBeenCalledWith(3);
  });

  it('builds the game from a snapshot when rejoining a game already in progress', async () => {
    const s = setup();
    await connected(s);
    joined(s);
    s.client().receive({ t: 'snapshot', snapshot: snapshot(), seq: 12 });
    expect(s.session.game.seq).toBe(12);
    expect(s.names()).toContain('started');
  });

  it('applies later snapshots to the running game instead of replacing it', async () => {
    const s = setup();
    await connected(s);
    joined(s);
    s.client().receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    const game = s.session.game;
    const handle = vi.spyOn(game, 'handle');
    s.client().receive({ t: 'snapshot', snapshot: snapshot(), seq: 5 });
    expect(s.session.game).toBe(game);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('goes back to the lobby when the room does (a rematch), ending the game', async () => {
    const s = setup();
    await connected(s);
    joined(s);
    s.client().receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    const game = s.session.game;
    const dispose = vi.spyOn(game, 'dispose');
    s.client().receive({ t: 'room', room: { phase: 'lobby', seats: [] } });
    expect(dispose).toHaveBeenCalled();
    expect(s.session.game).toBeNull();
    expect(s.names()).toContain('lobby');
  });

  it('lets the person retry when the server refuses something, and surfaces the error', async () => {
    const s = setup();
    await connected(s);
    joined(s);
    s.client().receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    const rejected = vi.spyOn(s.session.game, 'rejected');
    s.client().receive({ t: 'error', code: 'not_your_turn', message: 'It is not your turn.' });
    expect(rejected).toHaveBeenCalled();
    expect(s.events.find(([e]) => e === 'error')[1]).toEqual({ code: 'not_your_turn', message: 'It is not your turn.' });
  });

  it('forgets the saved seat when the server says the token is no good', async () => {
    const s = setup();
    await connected(s);
    s.session.store.save('BCDF', TOKEN);
    s.client().receive({ t: 'error', code: 'bad_token', message: 'gone' });
    expect(s.session.savedSeat()).toBeNull();
  });

  it('leaves cleanly: tells the server, forgets everything, ends the game', async () => {
    const s = setup();
    const c = await connected(s);
    joined(s);
    c.receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    const dispose = vi.spyOn(s.session.game, 'dispose');
    s.session.leave();
    expect(c.sent.at(-1)).toEqual({ t: 'leave' });
    expect(dispose).toHaveBeenCalled();
    expect(s.session).toMatchObject({ code: null, token: null, game: null, inRoom: false });
    expect(s.session.savedSeat()).toBeNull();
    expect(s.names()).toContain('left');
  });

  it('ignores unknown messages', async () => {
    const s = setup();
    await connected(s);
    expect(() => s.client().receive({ t: 'wat' })).not.toThrow();
  });
});

describe('reconnecting', () => {
  it('reconnects after an unexpected drop and takes the seat back with the saved token', async () => {
    const s = setup();
    const first = await connected(s);
    joined(s);
    first.dropped();
    expect(s.session.status).toBe('reconnecting');
    await s.timers.runNext(); // the first backoff delay passes
    expect(s.timers.delays[0]).toBe(500);
    const second = s.client();
    expect(second).not.toBe(first);
    expect(second.sent).toEqual([{ t: 'rejoin', code: 'BCDF', token: TOKEN }]);
    expect(s.session.status).toBe('connected');
  });

  it('backs off between attempts and keeps trying, then recovers', async () => {
    const s = setup();
    const first = await connected(s);
    joined(s);
    FakeClient.plan = [false, false, false, true];
    first.dropped();
    for (let i = 0; i < 4; i++) await s.timers.runNext();
    expect(s.timers.delays.slice(0, 4)).toEqual([500, 1000, 2000, 4000]);
    expect(s.session.status).toBe('connected');
    expect(s.client().sent).toEqual([{ t: 'rejoin', code: 'BCDF', token: TOKEN }]);
  });

  it('gives up after about a minute of failures', async () => {
    const s = setup();
    const first = await connected(s);
    joined(s);
    FakeClient.plan = Array(20).fill(false);
    first.dropped();
    for (let i = 0; i < 12; i++) await s.timers.runNext();
    expect(s.session.status).toBe('failed');
    expect(s.timers.delays).toHaveLength(10);
    expect(s.timers.delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(40_000);
  });

  it('reports the connection as gone (not still "connected") when it closes and no reconnect is wanted', async () => {
    const s = setup();
    const c = await connected(s);
    expect(s.session.status).toBe('connected');
    s.session.wantsConnection = false; // for example, the seat was taken over elsewhere
    c.dropped();
    expect(s.session.status).toBe('idle');
    expect(s.timers.pending).toHaveLength(0);
  });
  it('does not reconnect after a deliberate disconnect', async () => {
    const s = setup();
    const c = await connected(s);
    s.session.disconnect();
    c.dropped();
    expect(s.session.status).toBe('idle');
    expect(s.timers.pending).toHaveLength(0);
  });

  it('stops trying when the seat was taken over by another window', async () => {
    const s = setup();
    const c = await connected(s);
    joined(s);
    c.receive({ t: 'closed', reason: 'replaced' });
    c.dropped();
    expect(s.session.status).not.toBe('reconnecting');
    expect(s.events.find(([e, p]) => e === 'error' && p.code === 'replaced')).toBeTruthy();
  });

  it('can reconnect without being in a room (just the connection)', async () => {
    const s = setup();
    const c = await connected(s);
    c.dropped();
    await s.timers.runNext();
    expect(s.client().sent).toEqual([]); // nothing to rejoin
    expect(s.session.status).toBe('connected');
  });
});

describe('checking the connection when the page returns to the foreground', () => {
  it('pings the server, and reconnects at once if nothing comes back (a phone that slept)', async () => {
    const s = setup();
    const c = await connected(s);
    joined(s);
    s.session.refreshConnection();
    expect(c.sent.at(-1)).toEqual({ t: 'ping' });
    s.timers.runLast(); // three seconds pass with no answer
    expect(c.dropCalls).toBe(1);
    expect(s.session.status).toBe('reconnecting');
    await s.timers.runNext();
    expect(s.client().sent).toEqual([{ t: 'rejoin', code: 'BCDF', token: TOKEN }]);
  });

  it('leaves a healthy connection alone when the server answers', async () => {
    const s = setup();
    const c = await connected(s);
    s.session.refreshConnection();
    c.receive({ t: 'pong', seq: null });
    s.timers.runLast();
    expect(c.dropCalls).toBeUndefined();
    expect(s.session.status).toBe('connected');
  });

  it('starts reconnecting straight away if the connection is already known to be down', async () => {
    const s = setup();
    const c = await connected(s);
    c.connected = false; // the socket died without the page being told
    s.session.refreshConnection();
    expect(s.session.status).toBe('reconnecting');
  });

  it('does nothing when no connection is wanted, or there is no client yet', () => {
    const s = setup();
    expect(() => s.session.refreshConnection()).not.toThrow();
    expect(s.timers.pending).toHaveLength(0);
  });
});

describe('notices', () => {
  it('passes the game\'s notices on to the screens', async () => {
    const s = setup();
    const notices = [];
    s.session.on('notice', (n) => notices.push(n.text));
    await connected(s);
    joined(s);
    s.client().receive({ t: 'started', snapshot: snapshot(), seq: 0 });
    s.session.game.notify('hello');
    expect(notices).toEqual(['hello']);
  });
});