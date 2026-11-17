import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../server/Room.js';
import { RoomManager } from '../server/RoomManager.js';
import { parseClientMessage } from '../src/online/protocol.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

const WAIT = DEFAULT_CONFIG.matchWaitMs; // 20 seconds
const DELAY = DEFAULT_CONFIG.matchStartDelayMs;

function setup() {
  const clock = new FakeClock();
  let n = 0;
  let codeCount = 0;
  const codes = ['BCDF', 'GHJK', 'LMNP', 'QRST', 'VWXZ', 'BCDG'];
  const manager = new RoomManager({
    clock,
    roomOptions: { rng: seeded(1), makeToken: () => `token-${++n}-`.padEnd(24, 'x') },
    makeCode: () => codes[codeCount++ % codes.length],
  });
  return { manager, clock };
}

const connect = (manager) => {
  const conn = new FakeConn();
  return { conn, session: manager.newSession(conn) };
};
const quick = (manager, size, color) => {
  const client = connect(manager);
  manager.route(client.session, { t: 'quick', size, ...(color ? { color } : {}) });
  return client;
};
const startedPlayers = (client) => client.conn.last('started')?.snapshot.players;
const lastRoom = (client) => client.conn.last('room').room;

describe('"Play online" matchmaking', () => {
  it('puts the first person in a new public room that is waiting for others', () => {
    const { manager } = setup();
    const a = quick(manager, 4);
    expect(a.conn.last('joined')).toMatchObject({ code: 'BCDF', color: 'red' });
    expect(lastRoom(a)).toMatchObject({ matchmaking: true, maxSeats: 4, matchMsLeft: WAIT, phase: 'lobby' });
  });

  it('counts the wait down in the room information', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 4);
    clock.advance(7_000);
    quick(manager, 4); // the next arrival is told the time left
    expect(manager.rooms.get('BCDF').info(null).matchMsLeft).toBe(WAIT - 7_000);
    expect(a.conn.last('room').room.seats).toHaveLength(2);
  });

  it('matches people asking for the same size into one room, and keeps the sizes apart', () => {
    const { manager } = setup();
    const a = quick(manager, 2);
    const b = quick(manager, 4);
    const c = quick(manager, 2);
    expect(a.conn.last('joined').code).toBe(c.conn.last('joined').code);
    expect(b.conn.last('joined').code).not.toBe(a.conn.last('joined').code);
    expect(manager.rooms.size).toBe(2);
  });

  it('seats the second person of a 2-player match opposite the first', () => {
    const { manager } = setup();
    const a = quick(manager, 2);
    const b = quick(manager, 2);
    expect([a, b].map((p) => p.conn.last('joined').color)).toEqual(['red', 'yellow']);
  });

  it('starts shortly after the room fills up, without waiting the full time', () => {
    const { manager, clock } = setup();
    const people = [1, 2, 3, 4].map(() => quick(manager, 4));
    expect(people[0].conn.last('started')).toBeUndefined();
    clock.advance(DELAY - 1);
    expect(people[0].conn.last('started')).toBeUndefined();
    clock.advance(2);
    for (const p of people) expect(startedPlayers(p)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(people.every((p) => p.conn.last('room').room.seats.every((s) => s.kind === 'human'))).toBe(true);
  });

  it('fills the empty seats with computers by the end of the 20 seconds and starts', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 4);
    const b = quick(manager, 4);
    clock.advance(WAIT - 8000 - 1);
    expect(lastRoom(a).seats).toHaveLength(2); // nobody yet with more than 8 s left
    clock.advance(8001);
    for (const p of [a, b]) expect(startedPlayers(p)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(lastRoom(a).seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai', 'ai']);
  });

  describe('computers arriving one by one near the end of the wait', () => {
    const watch = (thinkRng) => {
      const clock = new FakeClock();
      let n = 0;
      const manager = new RoomManager({ clock, roomOptions: { rng: seeded(1), thinkRng, makeToken: () => `token-${++n}-`.padEnd(24, 'x') }, makeCode: () => 'BCDF' });
      const a = quick(manager, 4);
      const arrivals = []; // [ms left on the countdown, seats taken]
      for (let t = 0; t <= WAIT; t += 50) {
        const before = lastRoom(a).seats.length;
        if (t > 0) clock.advance(50);
        const after = (a.conn.last('room')?.room.seats.length) ?? before;
        if (after > before && !a.conn.last('started')) arrivals.push([WAIT - t, after]);
      }
      return { a, arrivals, manager, clock };
    };

    it('the first one comes with 5 to 8 seconds left, whatever the random draw', () => {
      for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
        const { arrivals } = watch(() => draw);
        const firstLeft = arrivals[0][0];
        expect(firstLeft, `draw ${draw}`).toBeLessThanOrEqual(8000);
        expect(firstLeft, `draw ${draw}`).toBeGreaterThanOrEqual(5000);
      }
    });

    it('they arrive one at a time, a little apart, and the game starts once the room is full (before the countdown ends)', () => {
      const { a, arrivals } = watch(seeded(4));
      expect(arrivals.map(([, seats]) => seats)).toEqual([2, 3, 4]);
      expect(arrivals[1][0]).toBeLessThan(arrivals[0][0]);
      expect(arrivals[2][0]).toBeLessThan(arrivals[1][0]);
      expect(arrivals[2][0]).toBeGreaterThanOrEqual(0);
      expect(startedPlayers(a)).toEqual(['red', 'green', 'yellow', 'blue']);
      expect(lastRoom(a).seats.map((s) => s.kind)).toEqual(['human', 'ai', 'ai', 'ai']);
    });

    it('a person who comes after the first computer still gets a free seat in the same match', () => {
      const clock = new FakeClock();
      const manager = new RoomManager({ clock, roomOptions: { rng: seeded(1), thinkRng: () => 0.5 }, makeCode: () => 'BCDF' });
      const a = quick(manager, 4);
      clock.advance(WAIT - 6400); // the first computer came with 6.5 s left
      expect(lastRoom(a).seats).toHaveLength(2);
      const b = quick(manager, 4);
      expect(b.conn.last('joined').code).toBe('BCDF');
      expect(lastRoom(b).seats.map((s) => s.kind)).toEqual(['human', 'ai', 'human']);
    });

    it('computers in a public match look like people on the waiting screen: an ordinary name each', () => {
      const { a } = watch(seeded(4));
      const names = lastRoom(a).seats.filter((s) => s.kind === 'ai').map((s) => s.name);
      expect(names).toHaveLength(3);
      expect(names.every((n) => n && n !== 'Computer')).toBe(true);
    });

    it('with matchBotsFromMs off, they all come at the end as before', () => {
      const clock = new FakeClock();
      const manager = new RoomManager({ clock, roomOptions: { rng: seeded(1), config: { matchBotsFromMs: null } }, makeCode: () => 'BCDF' });
      const a = quick(manager, 4);
      clock.advance(WAIT - 1);
      expect(lastRoom(a).seats).toHaveLength(1);
      clock.advance(1);
      expect(startedPlayers(a)).toEqual(['red', 'green', 'yellow', 'blue']);
    });
  });

  it('plays a lone 2-player search against a computer sitting opposite', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 2);
    clock.advance(WAIT);
    expect(startedPlayers(a)).toEqual(['red', 'yellow']);
    expect(lastRoom(a).seats.map((s) => [s.color, s.kind])).toEqual([['red', 'human'], ['yellow', 'ai']]);
  });

  it('lets a searching person cancel: the room goes away and no game starts', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 4);
    manager.route(a.session, { t: 'leave' });
    expect(manager.rooms.size).toBe(0);
    expect(clock.pending).toBe(0);
    clock.advance(WAIT * 2);
    expect(a.conn.last('started')).toBeUndefined();
  });

  it('calls off the start if someone leaves while the room was filling, and still falls back to computers', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 2);
    const b = quick(manager, 2);
    clock.advance(DELAY / 2);
    manager.route(b.session, { t: 'leave' });
    clock.advance(DELAY);
    expect(a.conn.last('started')).toBeUndefined(); // the room was not full any more
    clock.advance(WAIT);
    expect(startedPlayers(a)).toEqual(['red', 'yellow']);
  });

  it('sends a new searcher to a fresh room once the earlier one has started', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 2);
    clock.advance(WAIT);
    const b = quick(manager, 2);
    expect(b.conn.last('joined').code).not.toBe(a.conn.last('joined').code);
    expect(b.conn.last('started')).toBeUndefined();
  });

  it('puts a person who searches again into a different room than the one they left', () => {
    const { manager } = setup();
    const a = quick(manager, 4);
    manager.route(a.session, { t: 'quick', size: 2 });
    expect(manager.rooms.size).toBe(1);
    expect(lastRoom(a).maxSeats).toBe(2);
  });

  it('lets nobody manage the waiting room: start, computers and colours are refused', () => {
    const { manager } = setup();
    const a = quick(manager, 4);
    for (const msg of [{ t: 'start' }, { t: 'addAi' }, { t: 'color', color: 'blue' }, { t: 'removeAi', color: 'green' }]) {
      a.conn.clear();
      manager.route(a.session, msg);
      expect(a.conn.last('error')?.code, msg.t).toBe('bad_phase');
    }
    expect(a.conn.last('started')).toBeUndefined();
  });

  it('is not used by rooms made with a code: those still wait for the host', () => {
    const { manager, clock } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 2 });
    expect(lastRoom(host).matchmaking).toBe(false);
    clock.advance(WAIT * 3);
    expect(host.conn.last('started')).toBeUndefined();
    const stranger = quick(manager, 2); // never put into a private room
    expect(stranger.conn.last('joined').code).not.toBe(host.conn.last('joined').code);
  });

  it('turns into an ordinary room for a rematch (the host manages it, the 20 seconds do not start again)', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 2);
    clock.advance(WAIT);
    const room = manager.rooms.get(a.conn.last('joined').code);
    room.phase = 'over'; // as if the game had been played to the end
    manager.route(a.session, { t: 'rematch' });
    expect(lastRoom(a)).toMatchObject({ phase: 'lobby', matchmaking: false, matchMsLeft: null });
    a.conn.clear();
    clock.advance(WAIT * 2);
    expect(a.conn.last('started')).toBeUndefined();
  });
});

describe('quick message validation', () => {
  const parse = (m) => parseClientMessage(JSON.stringify(m));
  it('accepts 2 and 4 players only', () => {
    expect(parse({ t: 'quick', size: 2 })).toEqual({ ok: true, msg: { t: 'quick', size: 2 } });
    expect(parse({ t: 'quick', size: 4 }).ok).toBe(true);
    for (const size of [1, 3, 5, '2', null, undefined, 2.5]) expect(parse({ t: 'quick', size }).ok, String(size)).toBe(false);
  });

  it('accepts an optional colour, and only a real one', () => {
    expect(parse({ t: 'quick', size: 4, color: 'blue' })).toEqual({ ok: true, msg: { t: 'quick', size: 4, color: 'blue' } });
    expect(parse({ t: 'quick', size: 4 }).msg).toEqual({ t: 'quick', size: 4 }); // no colour: none is added
    for (const color of ['purple', '', 'BLUE', 7, null, {}, ['red']]) expect(parse({ t: 'quick', size: 4, color }).ok, JSON.stringify(color)).toBe(false);
  });
});

describe('"Play online" colour choice', () => {
  const colorOf = (client) => client.conn.last('joined').color;

  it('seats a person in the colour they asked for, in a new room and in an open one', () => {
    const { manager } = setup();
    const a = quick(manager, 4, 'blue');
    expect(colorOf(a)).toBe('blue');
    const b = quick(manager, 4, 'green');
    expect(b.conn.last('joined').code).toBe(a.conn.last('joined').code);
    expect(colorOf(b)).toBe('green');
    expect(lastRoom(a).seats.map((s) => s.color)).toEqual(['green', 'blue']); // in colour order
    expect(manager.rooms.size).toBe(1);
  });

  it('keeps people together when two want the same colour: the second is seated in another colour of the same room', () => {
    const { manager } = setup();
    const a = quick(manager, 4, 'red');
    const b = quick(manager, 4, 'red');
    expect(a.conn.last('joined').code).toBe(b.conn.last('joined').code);
    expect(colorOf(a)).toBe('red');
    expect(colorOf(b)).not.toBe('red');
    expect(manager.rooms.size).toBe(1);
  });

  it('still seats a person who names no colour in the first free one', () => {
    const { manager } = setup();
    expect(colorOf(quick(manager, 4))).toBe('red');
    expect(colorOf(quick(manager, 4))).toBe('green');
  });

  it('keeps the chosen colour when computers fill the empty seats, and the computers take the others', () => {
    const { manager, clock } = setup();
    const a = quick(manager, 4, 'blue');
    clock.advance(WAIT);
    expect(startedPlayers(a)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(lastRoom(a).seats.map((s) => [s.color, s.kind])).toEqual([['red', 'ai'], ['green', 'ai'], ['yellow', 'ai'], ['blue', 'human']]);
    expect(a.conn.last('room').room.you).toBe('blue');
  });

  it('gives each of four people their own colour when they all ask for different ones', () => {
    const { manager, clock } = setup();
    const people = ['yellow', 'blue', 'green', 'red'].map((c) => quick(manager, 4, c));
    expect(people.map(colorOf)).toEqual(['yellow', 'blue', 'green', 'red']);
    clock.advance(DELAY);
    for (const p of people) expect(startedPlayers(p)).toEqual(['red', 'green', 'yellow', 'blue']);
  });

  it('does not let a colour choice change rooms made with a code', () => {
    const { manager } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 3 });
    expect(colorOf(host)).toBe('red'); // a friends room seats the host in the first colour, as before
    const guest = connect(manager);
    manager.route(guest.session, { t: 'join', code: 'BCDF' });
    expect(colorOf(guest)).toBe('green');
  });
});