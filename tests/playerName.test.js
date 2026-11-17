import { describe, it, expect } from 'vitest';
import { createProfileStore } from '../src/config/profileStore.js';
import { NAME_MAX, NAME_MIN, randomName, validateName } from '../src/game/playerName.js';
import { parseClientMessage } from '../src/online/protocol.js';
import { perspectiveColors } from '../src/game/perspective.js';
import { DEFAULT_CONFIG, Room } from '../server/Room.js';
import { RoomManager } from '../server/RoomManager.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
};

describe('validateName', () => {
  it('accepts letters, numbers and underscores from 3 to 16 characters', () => {
    for (const name of ['abc', 'Player482', 'a_b_c', 'X'.repeat(NAME_MAX), '123', '___']) {
      expect(validateName(name), name).toEqual({ ok: true, name });
    }
  });

  it('removes spaces around the name, and keeps the rest', () => {
    expect(validateName('  Ludo_King  ')).toEqual({ ok: true, name: 'Ludo_King' });
    expect(validateName('\tAmy\n')).toEqual({ ok: true, name: 'Amy' });
  });

  it('rejects empty names, with a message', () => {
    for (const text of ['', '   ', '\t']) {
      const r = validateName(text);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/enter a name/i);
    }
    expect(validateName(undefined).ok).toBe(false);
    expect(validateName(null).ok).toBe(false);
    expect(validateName(42).ok).toBe(false);
  });

  it('rejects names that are too short or too long, and says so', () => {
    expect(validateName('ab')).toEqual({ ok: false, error: `Use at least ${NAME_MIN} characters.` });
    expect(validateName('x'.repeat(NAME_MAX + 1))).toEqual({ ok: false, error: `Use at most ${NAME_MAX} characters.` });
  });

  it('rejects anything but letters, numbers and underscores (spaces inside, symbols, accents, emoji)', () => {
    for (const name of ['two words', 'hello!', 'a-b-c', 'name@home', 'café', '名前名前', 'abc😀', 'a.b', "o'neil", '<b>bold</b>']) {
      const r = validateName(name);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toMatch(/letters, numbers/);
    }
  });

  it('rejects rude names, also when disguised with digits, underscores or capitals', () => {
    for (const name of ['fuck', 'F_u_c_k', 'sh1t', 'xxB1tchxx', 'N4Z1', 'ADMIN', 'Mod3rator']) {
      const r = validateName(name);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toMatch(/different name/i);
    }
  });

  it('does not reject ordinary names that merely contain such letters', () => {
    for (const name of ['Grape', 'Peacock', 'Dickson', 'Classic', 'Assassin1']) expect(validateName(name).ok, name).toBe(true);
  });
});

describe('randomName', () => {
  it('looks like Player482 / User729 / LudoPlayer156 and is always a valid name', () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i++) {
      const name = randomName(rng);
      expect(name).toMatch(/^(Player|User|LudoPlayer)[1-9]\d\d$/);
      expect(validateName(name).ok, name).toBe(true);
    }
  });

  it('uses all the prefixes and varies', () => {
    const rng = seeded(11);
    const names = new Set(Array.from({ length: 200 }, () => randomName(rng)));
    expect(new Set([...names].map((n) => n.match(/^[A-Za-z]+/)[0]))).toEqual(new Set(['Player', 'User', 'LudoPlayer']));
    expect(names.size).toBeGreaterThan(50);
  });
});

describe('the profile store', () => {
  it('makes up a name the first time and saves it', () => {
    const storage = memoryStorage();
    const store = createProfileStore(() => storage, seeded(1));
    const name = store.name();
    expect(validateName(name).ok).toBe(true);
    expect(JSON.parse(storage.getItem('ludo.profile.v1'))).toEqual({ name });
  });

  it('gives the same name every time, also after a "restart" (a new store over the same storage), and does not draw a new one', () => {
    const storage = memoryStorage();
    const first = createProfileStore(() => storage, seeded(1)).name();
    const rng = () => { throw new Error('a new name must not be made up'); };
    const again = createProfileStore(() => storage, rng);
    expect(again.name()).toBe(first);
    expect(again.name()).toBe(first);
  });

  it('saves a name the person chose, keeps it after a restart, and never replaces it with a random one', () => {
    const storage = memoryStorage();
    const store = createProfileStore(() => storage, seeded(1));
    store.name();
    expect(store.setName('  Ludo_King ')).toEqual({ ok: true, name: 'Ludo_King' });
    expect(store.name()).toBe('Ludo_King');
    const restarted = createProfileStore(() => storage, seeded(99));
    expect(restarted.name()).toBe('Ludo_King');
  });

  it('refuses an invalid name, says why, and keeps the old one', () => {
    const storage = memoryStorage();
    const store = createProfileStore(() => storage, seeded(1));
    const before = store.name();
    const r = store.setName('no spaces');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(store.name()).toBe(before);
    expect(JSON.parse(storage.getItem('ludo.profile.v1')).name).toBe(before);
    expect(store.setName('ab').ok).toBe(false);
    expect(store.setName('').ok).toBe(false);
  });

  it('makes a new name when the saved data is missing, damaged or holds an invalid name', () => {
    for (const saved of [undefined, 'not json', '{"name":"x"}', '{"name":"bad name!"}', '{}', 'null']) {
      const storage = memoryStorage(saved === undefined ? {} : { 'ludo.profile.v1': saved });
      const name = createProfileStore(() => storage, seeded(3)).name();
      expect(validateName(name).ok, String(saved)).toBe(true);
      expect(JSON.parse(storage.getItem('ludo.profile.v1')).name).toBe(name);
    }
  });

  it('still gives one steady name when storage is unavailable or throws', () => {
    for (const getStorage of [() => undefined, () => { throw new Error('blocked'); }, () => ({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('full'); } })]) {
      const store = createProfileStore(getStorage, seeded(5));
      const name = store.name();
      expect(validateName(name).ok).toBe(true);
      expect(store.name()).toBe(name);
      expect(store.setName('Custom_1').ok).toBe(true);
      expect(store.name()).toBe('Custom_1');
    }
  });
});

describe('names in messages to the server', () => {
  const parse = (m) => parseClientMessage(JSON.stringify(m));

  it('passes a valid name on (cleaned), for create, quick and join', () => {
    expect(parse({ t: 'quick', size: 4, name: ' Amy_1 ' })).toEqual({ ok: true, msg: { t: 'quick', size: 4, name: 'Amy_1' } });
    expect(parse({ t: 'join', code: 'BCDF', name: 'Bob' })).toEqual({ ok: true, msg: { t: 'join', code: 'BCDF', name: 'Bob' } });
    expect(parse({ t: 'create', seats: 2, name: 'Cy_2' }).msg.name).toBe('Cy_2');
  });

  it('still accepts messages without a name', () => {
    expect(parse({ t: 'quick', size: 4 }).ok).toBe(true);
    expect(parse({ t: 'join', code: 'BCDF' }).ok).toBe(true);
  });

  it('refuses an invalid name instead of quietly changing it', () => {
    for (const name of ['', 'ab', 'x'.repeat(17), 'has space', 'fuck', 5, null, {}, ['Amy']]) {
      const r = parse({ t: 'quick', size: 4, name });
      expect(r.ok, JSON.stringify(name)).toBe(false);
      expect(r.error).toMatch(/^invalid name/);
    }
  });
});

// The server side, through the real room manager.
function matchOf(names) {
  const clock = new FakeClock();
  let n = 0;
  const manager = new RoomManager({ clock, roomOptions: { rng: seeded(3), makeToken: () => `tok${++n}`.padEnd(24, 'x') }, makeCode: () => 'BCDF' });
  const people = names.map((name) => {
    const conn = new FakeConn();
    const session = manager.newSession(conn);
    manager.route(session, { t: 'quick', size: 4, color: 'red', ...(name === undefined ? {} : { name }) });
    return { conn, session };
  });
  return { manager, clock, people };
}

describe('names in an online room', () => {
  it('two people with the same name are still two different players (own seat, own id)', () => {
    const { people } = matchOf(['Same_Name', 'Same_Name']);
    const [a, b] = people.map((p) => p.conn.last('joined'));
    expect(a.name).toBe('Same_Name');
    expect(b.name).toBe('Same_Name');
    expect(a.id).not.toBe(b.id);
    expect(a.color).not.toBe(b.color);
    expect(a.token).not.toBe(b.token);
    const room = people[1].conn.last('room').room;
    expect(room.seats.map((s) => s.name)).toEqual(['Same_Name', 'Same_Name']);
    expect(new Set(room.seats.map((s) => s.id)).size).toBe(2);
    expect(room.youId).toBe(b.id);
  });

  it('shows everybody\'s name to everybody, with computers called Computer', () => {
    const { people, clock } = matchOf(['Amy_1', 'Bob_2']);
    clock.advance(DEFAULT_CONFIG.matchWaitMs + 10); // nobody else came: computers fill the seats
    const room = people[0].conn.last('room').room;
    expect(room.seats.map((s) => [s.kind, s.name]).slice(0, 2)).toEqual([['human', 'Amy_1'], ['human', 'Bob_2']]);
    const bots = room.seats.filter((s) => s.kind === 'ai').map((s) => s.name);
    expect(bots).toHaveLength(2);
    expect(bots.every((n) => validateName(n).ok && n !== 'Computer')).toBe(true); // ordinary usernames
    expect(people[1].conn.last('room').room.seats.map((s) => s.name)).toEqual(room.seats.map((s) => s.name));
  });

  it('falls back to "Player" for a client that sends no name, and keeps the room working', () => {
    const { people } = matchOf([undefined, 'Amy_1']);
    expect(people[0].conn.last('joined').name).toBe('Player');
    expect(people[1].conn.last('room').room.seats.map((s) => s.name)).toEqual(['Player', 'Amy_1']);
  });

  it('does not trust the name it is given: an invalid one that got past the protocol check shows as "Player"', () => {
    const room = new Room({ code: 'BCDF', seats: 2, rng: seeded(1) });
    const conn = new FakeConn();
    room.join(conn, null, '<script>x</script>');
    expect(conn.last('joined').name).toBe('Player');
    expect(conn.last('room').room.seats[0].name).toBe('Player');
  });

  it('gives a person back their name, id and seat when they reconnect', () => {
    const { manager, people } = matchOf(['Amy_1', 'Bob_2']);
    const before = people[1].conn.last('joined');
    manager.closed(people[1].session); // the connection drops
    const conn = new FakeConn();
    const session = manager.newSession(conn);
    manager.route(session, { t: 'rejoin', code: before.code, token: before.token });
    expect(conn.last('joined')).toMatchObject({ name: 'Bob_2', id: before.id, color: before.color });
    expect(conn.last('room').room.seats.map((s) => s.name)).toEqual(['Amy_1', 'Bob_2']);
  });

  it('keeps names with their seats through the game: the same name belongs to the same seat on every screen, whatever colours they paint', () => {
    const { people } = matchOf(['Amy_1', 'Bob_2', 'Cy_3', 'Di_4']); // all four asked for red
    const seatOf = Object.fromEntries(people.map((p) => [p.conn.last('joined').name, p.conn.last('joined').color]));
    const seats = Object.values(seatOf);
    for (const p of people) {
      const me = p.conn.last('joined');
      const room = p.conn.last('room').room;
      const map = perspectiveColors({ seat: me.color, preferred: me.preferred, seats });
      expect(map[me.color]).toBe('red'); // everyone sees themselves in red...
      for (const [name, seat] of Object.entries(seatOf)) expect(room.seats.find((s) => s.color === seat).name).toBe(name); // ...and everybody's name stays with their seat
    }
  });
});
