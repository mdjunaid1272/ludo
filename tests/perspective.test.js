import { describe, it, expect } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { gridRect } from '../src/board/geometry.js';
import { COLORS } from '../src/config/constants.js';
import { makePalette } from '../src/config/palette.js';
import { identityColors, perspectiveColors } from '../src/game/perspective.js';
import { HOME_LANE_CELLS, PLAYER_IDS, YARD_CORNER } from '../src/game/path.js';
import { DEFAULT_CONFIG } from '../server/Room.js';
import { RoomManager } from '../server/RoomManager.js';
import { GameState } from '../src/game/GameState.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

const distinct = (map) => new Set(Object.values(map)).size === Object.keys(map).length;

describe('perspectiveColors: how one screen paints the seats', () => {
  it('paints your own seat in the colour you asked for, and the other seat in a different one (two players, both want red)', () => {
    const a = perspectiveColors({ seat: 'red', preferred: 'red', seats: ['red', 'yellow'] });
    const b = perspectiveColors({ seat: 'yellow', preferred: 'red', seats: ['red', 'yellow'] });
    expect(a).toEqual({ red: 'red', yellow: 'yellow' });
    expect(b.yellow).toBe('red'); // the person in the yellow seat sees themselves as red...
    expect(b.red).not.toBe('red'); // ...and the other person in some other colour
    expect(distinct(b)).toBe(true);
  });

  it('gives every seat a different colour from every screen, with 2, 3 and 4 people all asking for red', () => {
    for (const seats of [['red', 'yellow'], ['red', 'green', 'yellow'], ['red', 'green', 'yellow', 'blue']]) {
      for (const seat of seats) {
        const map = perspectiveColors({ seat, preferred: 'red', seats });
        expect(map[seat], `own colour (seat ${seat}, ${seats.length} players)`).toBe('red');
        expect(Object.keys(map).sort()).toEqual([...seats].sort());
        expect(distinct(map), `distinct colours (seat ${seat}, ${seats.length} players)`).toBe(true);
      }
    }
  });

  it('gives everyone their own choice for every combination of wishes, and never repeats a colour', () => {
    const seats = PLAYER_IDS;
    for (const preferred of PLAYER_IDS) {
      for (const seat of seats) {
        const map = perspectiveColors({ seat, preferred, seats });
        expect(map[seat]).toBe(preferred);
        expect(distinct(map)).toBe(true);
      }
    }
  });

  it('keeps the usual colours when nobody clashes', () => {
    expect(perspectiveColors({ seat: 'green', preferred: 'green', seats: PLAYER_IDS })).toEqual(identityColors());
    // somebody else's seat keeps its colour when the colour is free
    expect(perspectiveColors({ seat: 'red', preferred: 'blue', seats: ['red', 'green', 'blue'] })).toEqual({ red: 'blue', green: 'green', blue: 'red' });
  });

  it('is deterministic: the same input (in any order) gives the same map', () => {
    const one = perspectiveColors({ seat: 'blue', preferred: 'red', seats: ['red', 'green', 'yellow', 'blue'] });
    const two = perspectiveColors({ seat: 'blue', preferred: 'red', seats: ['blue', 'yellow', 'green', 'red'] });
    expect(two).toEqual(one);
  });

  it('uses the seat\'s own colour when no preference is known', () => {
    expect(perspectiveColors({ seat: 'green', preferred: null, seats: ['red', 'green'] })).toEqual({ red: 'red', green: 'green' });
    expect(perspectiveColors({ seat: 'green', preferred: 'purple', seats: ['red', 'green'] })).toEqual({ red: 'red', green: 'green' });
  });
});

describe('makePalette', () => {
  it('answers with the display colour, keeping the seat as the id', () => {
    const palette = makePalette({ yellow: 'red', red: 'blue' });
    expect(palette.color('yellow')).toBe(COLORS.red);
    expect(palette.label('yellow')).toBe('RED');
    expect(palette.entry('yellow')).toMatchObject({ id: 'yellow', label: 'RED', color: COLORS.red });
    expect(palette.color('green')).toBe(COLORS.green); // not in the map: its own colour
  });

  it('uses a deeper shade of yellow for text', () => {
    expect(makePalette().textColor('yellow')).toBe(0xfbc02d);
    expect(makePalette({ red: 'yellow' }).textColor('red')).toBe(0xfbc02d);
    expect(makePalette().textColor('red')).toBe(COLORS.red);
  });
});

// A recording stand-in for a Phaser scene: remembers every filled rectangle and the label texts.
function paint(palette) {
  const fills = [];
  const labels = [];
  let color = null;
  const g = new Proxy({}, {
    get: (_, name) => {
      if (name === 'fillStyle') return (c) => { color = c; return g; };
      if (name === 'fillRect') return (x, y, w, h) => { fills.push({ color, x, y, w, h }); return g; };
      return () => g;
    },
  });
  drawBoard({ add: { graphics: () => g } }, { palette, makeText: (_s, _x, _y, label) => (labels.push(label), { setOrigin() { return this; } }) });
  return { fills, labels };
}

describe('drawing the board with a perspective palette', () => {
  it('paints each yard, home lane and name in the display colour, and leaves the positions alone', () => {
    const palette = makePalette({ red: 'blue', blue: 'red' });
    const mine = paint(palette);
    const plain = paint(makePalette());
    expect(mine.fills).toHaveLength(plain.fills.length);
    mine.fills.forEach((f, i) => expect({ x: f.x, y: f.y, w: f.w, h: f.h }).toEqual({ x: plain.fills[i].x, y: plain.fills[i].y, w: plain.fills[i].w, h: plain.fills[i].h }));
    const at = (fills, c, r) => { const rc = gridRect(c, r, 1, 1); return fills.find((f) => f.x === rc.x && f.y === rc.y && f.w === rc.w && f.h === rc.h); };
    const [c, r] = HOME_LANE_CELLS.red[2];
    expect(at(plain.fills, c, r).color).toBe(COLORS.red);
    expect(at(mine.fills, c, r).color).toBe(COLORS.blue);
    const yard = (fills, seat) => { const [cc, rr] = YARD_CORNER[seat]; const rc = gridRect(cc, rr, 6, 6); return fills.find((f) => f.x === rc.x && f.y === rc.y && f.w === rc.w && f.h === rc.h).color; };
    expect(yard(mine.fills, 'red')).toBe(COLORS.blue);
    expect(yard(mine.fills, 'blue')).toBe(COLORS.red);
    expect(yard(mine.fills, 'green')).toBe(COLORS.green);
    expect(mine.labels).toEqual(['BLUE', 'GREEN', 'YELLOW', 'RED']); // the yard of the red seat is named BLUE on this screen
    expect(plain.labels).toEqual(['RED', 'GREEN', 'YELLOW', 'BLUE']);
  });
});

// The server side, through the real room manager.
function lobbyOf(count, wanted = 'red') {
  const clock = new FakeClock();
  let n = 0;
  let codes = 0;
  const manager = new RoomManager({ clock, roomOptions: { rng: seeded(3), makeToken: () => `tok${++n}`.padEnd(24, 'x') }, makeCode: () => ['BCDF', 'GHJK'][codes++ % 2] });
  const people = [];
  for (let i = 0; i < count; i++) {
    const conn = new FakeConn();
    const session = manager.newSession(conn);
    manager.route(session, { t: 'quick', size: 4, color: wanted });
    people.push({ conn, session });
  }
  return { manager, clock, people };
}

describe('everybody may ask for the same colour online', () => {
  for (const count of [2, 3, 4]) {
    it(`${count} people who all ask for red: one room, different seats, everyone's choice remembered`, () => {
      const { manager, people } = lobbyOf(count);
      expect(manager.rooms.size).toBe(1);
      const joined = people.map((p) => p.conn.last('joined'));
      expect(new Set(joined.map((j) => j.color)).size).toBe(count); // a seat is never shared
      expect(joined.map((j) => j.preferred)).toEqual(Array(count).fill('red'));
      expect(joined[0].color).toBe('red'); // the first one gets the red seat
      // each screen paints its own seat red and every other seat differently
      const seats = joined.map((j) => j.color);
      for (const j of joined) {
        const map = perspectiveColors({ seat: j.color, preferred: j.preferred, seats });
        expect(map[j.color]).toBe('red');
        expect(distinct(map)).toBe(true);
      }
    });
  }

  it('does not change the game: the game only ever deals in seats, and everybody gets the same events', () => {
    const { manager, clock, people } = lobbyOf(4);
    clock.advance(DEFAULT_CONFIG.matchStartDelayMs + 10);
    const started = people.map((p) => p.conn.last('started'));
    expect(started.every(Boolean)).toBe(true);
    for (const s of started) expect(s.snapshot).toEqual(started[0].snapshot);
    expect(started[0].snapshot.players).toEqual(PLAYER_IDS); // seats, not anybody's colour
    // the person to move rolls: every screen gets the identical event, which names the seat
    const room = [...manager.rooms.values()][0];
    const mover = people.find((p) => p.conn.last('joined').color === GameState.fromSnapshot(started[0].snapshot).currentPlayer);
    manager.route(mover.session, { t: 'roll' });
    const rolled = people.map((p) => p.conn.last('rolled'));
    for (const r of rolled) expect(r).toEqual(rolled[0]);
    expect(rolled[0].player).toBe(mover.conn.last('joined').color);
    expect(room.members.size).toBe(4);
  });

  it('a person coming back is told their seat and their colour again', () => {
    const { manager, clock, people } = lobbyOf(2);
    const before = people[1].conn.last('joined');
    const token = before.token;
    manager.closed(people[1].session); // the connection drops
    const conn = new FakeConn();
    const session = manager.newSession(conn);
    manager.route(session, { t: 'rejoin', code: before.code, token });
    expect(conn.last('joined')).toMatchObject({ color: before.color, preferred: 'red' });
    void clock;
  });

  it('puts your preferred colour in the room information you are sent', () => {
    const { people } = lobbyOf(2);
    const info = people[1].conn.last('room').room;
    expect(info.youPreferred).toBe('red');
    expect(info.you).not.toBe('red');
  });
});
