import { describe, it, expect } from 'vitest';
import { RoomManager, randomCode, DEFAULT_LIMITS } from '../server/RoomManager.js';
import { ROOM_CODE_ALPHABET, isRoomCode } from '../src/online/protocol.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

function setup(options = {}) {
  const clock = new FakeClock();
  let n = 0;
  const codes = options.codes ?? ['BCDF', 'GHJK', 'LMNP', 'QRST', 'VWXZ'];
  const manager = new RoomManager({
    clock,
    limits: options.limits,
    roomOptions: { rng: seeded(1), makeToken: () => `token-${++n}-`.padEnd(24, 'x') },
    makeCode: () => codes[Math.min(manager.rooms.size + (options.collisions ?? 0), codes.length - 1)],
  });
  return { manager, clock };
}
const connect = (manager) => {
  const conn = new FakeConn();
  return { conn, session: manager.newSession(conn) };
};
const err = (client) => client.conn.last('error')?.code;

describe('room codes', () => {
  it('are random 4-letter codes from the allowed alphabet', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const code = randomCode();
      expect(isRoomCode(code), code).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(250); // 160,000 possible codes: collisions are rare
    expect([...seen].join('')).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`));
  });
});

describe('creating, joining and rejoining', () => {
  it('creates a room, makes the creator the host, and lets others join by code', () => {
    const { manager } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 3 });
    expect(host.conn.last('joined')).toMatchObject({ code: 'BCDF', color: 'red' });
    expect(host.conn.last('room').room.seats[0].host).toBe(true);

    const guest = connect(manager);
    manager.route(guest.session, { t: 'join', code: 'BCDF' });
    expect(guest.conn.last('joined')).toMatchObject({ code: 'BCDF', color: 'green' });
    expect(host.conn.last('room').room.seats).toHaveLength(2); // the host sees the guest arrive
  });

  it('rejects an unknown code, a full room, and a game already started', () => {
    const { manager } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 2 });
    const nobody = connect(manager);
    manager.route(nobody.session, { t: 'join', code: 'ZZZZ' });
    expect(err(nobody)).toBe('no_such_room');

    const guest = connect(manager);
    manager.route(guest.session, { t: 'join', code: 'BCDF' });
    const third = connect(manager);
    manager.route(third.session, { t: 'join', code: 'BCDF' });
    expect(err(third)).toBe('room_full');

    manager.route(host.session, { t: 'start' });
    const late = connect(manager);
    manager.route(late.session, { t: 'join', code: 'BCDF' });
    expect(err(late)).toBe('in_progress');
  });

  it('routes game messages to the right room, and rejects them from someone with no room', () => {
    const { manager } = setup();
    const loner = connect(manager);
    manager.route(loner.session, { t: 'roll' });
    expect(err(loner)).toBe('no_room');

    const a = connect(manager);
    const b = connect(manager);
    manager.route(a.session, { t: 'create', seats: 2 });
    manager.route(b.session, { t: 'create', seats: 2 }); // a second, separate room
    expect(b.conn.last('joined').code).not.toBe(a.conn.last('joined').code);
    expect(manager.rooms.size).toBe(2);
    manager.route(a.session, { t: 'addAi' });
    expect(a.conn.last('room').room.seats).toHaveLength(2);
    expect(b.conn.last('room').room.seats).toHaveLength(1); // b's room is untouched
  });

  it('answers ping with pong, carrying the room\'s latest event number once in a game', () => {
    const { manager } = setup();
    const c = connect(manager);
    manager.route(c.session, { t: 'ping' });
    expect(c.conn.last('pong')).toEqual({ t: 'pong', seq: null });
    const g = connect(manager);
    manager.route(c.session, { t: 'create', seats: 2 });
    manager.route(g.session, { t: 'join', code: 'BCDF' });
    manager.route(c.session, { t: 'start' });
    manager.route(c.session, { t: 'ping' });
    expect(c.conn.last('pong').seq).toBe(0);
    manager.route(c.session, { t: 'roll' });
    manager.route(c.session, { t: 'ping' });
    expect(c.conn.last('pong').seq).toBeGreaterThan(0);
  });

  it('lets a person rejoin with their token from a new connection, and closes the old one', () => {
    const { manager } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 2 });
    const { token } = host.conn.last('joined');
    manager.closed(host.session); // connection dropped

    const back = connect(manager);
    manager.route(back.session, { t: 'rejoin', code: 'BCDF', token });
    expect(back.conn.last('joined')).toMatchObject({ code: 'BCDF', color: 'red', token });
    expect(back.session.room).toBe(host.session.room);
  });

  it('closes the previous socket when the same seat is taken over', () => {
    const { manager } = setup();
    const host = connect(manager);
    let closed = false;
    host.conn.close = () => (closed = true);
    manager.route(host.session, { t: 'create', seats: 2 });
    const { token } = host.conn.last('joined');
    const second = connect(manager);
    manager.route(second.session, { t: 'rejoin', code: 'BCDF', token });
    expect(closed).toBe(true);
  });

  it('refuses a rejoin with the wrong token or for a missing room', () => {
    const { manager } = setup();
    const host = connect(manager);
    manager.route(host.session, { t: 'create', seats: 2 });
    const thief = connect(manager);
    manager.route(thief.session, { t: 'rejoin', code: 'BCDF', token: 'guessed-token-guessed-token' });
    expect(err(thief)).toBe('bad_token');
    manager.route(thief.session, { t: 'rejoin', code: 'ZZZZ', token: 'guessed-token-guessed-token' });
    expect(err(thief)).toBe('no_such_room');
    expect(thief.session.room).toBeNull();
  });

  it('creating or joining another room first leaves the current one', () => {
    const { manager } = setup();
    const a = connect(manager);
    manager.route(a.session, { t: 'create', seats: 2 });
    const first = a.session.room;
    manager.route(a.session, { t: 'create', seats: 3 });
    expect(a.session.room).not.toBe(first);
    expect(manager.rooms.size).toBe(1); // the abandoned first room was removed
    expect([...manager.rooms.values()]).toEqual([a.session.room]);
  });
});

describe('limits and cleanup', () => {
  it('refuses to create rooms beyond the limit', () => {
    const { manager } = setup({ limits: { maxRooms: 2 } });
    for (let i = 0; i < 2; i++) manager.route(connect(manager).session, { t: 'create', seats: 2 });
    const extra = connect(manager);
    manager.route(extra.session, { t: 'create', seats: 2 });
    expect(err(extra)).toBe('busy');
    expect(manager.rooms.size).toBe(2);
  });

  it('retries on a code collision and gives up politely if it cannot find a free code', () => {
    const { manager } = setup({ codes: ['BCDF'] });
    manager.route(connect(manager).session, { t: 'create', seats: 2 });
    const second = connect(manager);
    manager.route(second.session, { t: 'create', seats: 2 }); // every code it can generate is taken
    expect(err(second)).toBe('busy');
    expect(manager.rooms.size).toBe(1);
  });

  it('sweeps a game room nobody has been connected to for a long time, but not a recent one', () => {
    const { manager, clock } = setup();
    const host = connect(manager);
    const guest = connect(manager);
    manager.route(host.session, { t: 'create', seats: 2 });
    manager.route(guest.session, { t: 'join', code: 'BCDF' });
    manager.route(host.session, { t: 'start' });
    manager.closed(host.session);
    manager.closed(guest.session); // both disconnected, but their seats are kept for a rejoin
    clock.advance(DEFAULT_LIMITS.emptyRoomMs - 1);
    manager.sweep();
    expect(manager.rooms.size).toBe(1);
    clock.advance(1);
    manager.sweep();
    expect(manager.rooms.size).toBe(0);
  });

  it('frees a lobby seat after the grace period, which empties and removes the room', () => {
    const { manager, clock } = setup();
    const a = connect(manager);
    manager.route(a.session, { t: 'create', seats: 2 });
    manager.closed(a.session);
    clock.advance(59_000);
    manager.sweep();
    expect(manager.rooms.size).toBe(1); // still holding the seat
    clock.advance(2_000);
    manager.sweep();
    expect(manager.rooms.size).toBe(0);
  });
  it('keeps a room that someone is still connected to, however old', () => {
    const { manager, clock } = setup();
    const a = connect(manager);
    manager.route(a.session, { t: 'create', seats: 2 });
    clock.advance(DEFAULT_LIMITS.emptyRoomMs * 5);
    manager.sweep();
    expect(manager.rooms.size).toBe(1);
  });

  it('removes a room when everyone has left it', () => {
    const { manager } = setup();
    const a = connect(manager);
    manager.route(a.session, { t: 'create', seats: 2 });
    manager.route(a.session, { t: 'leave' });
    expect(manager.rooms.size).toBe(0);
    expect(a.session.room).toBeNull();
  });

  it('close() discards everything', () => {
    const { manager } = setup();
    manager.route(connect(manager).session, { t: 'create', seats: 2 });
    manager.close();
    expect(manager.rooms.size).toBe(0);
  });
});
