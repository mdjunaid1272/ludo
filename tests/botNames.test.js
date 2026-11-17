import { describe, it, expect } from 'vitest';
import { BOT_NAMES, botName } from '../src/game/botNames.js';
import { validateName } from '../src/game/playerName.js';
import { DEFAULT_CONFIG, Room } from '../server/Room.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

describe('bot names', () => {
  it('are all valid player names, all different, and none says "computer"', () => {
    for (const name of BOT_NAMES) {
      expect(validateName(name).ok, name).toBe(true);
      expect(name.toLowerCase()).not.toMatch(/computer|bot|cpu/);
    }
    expect(new Set(BOT_NAMES.map((n) => n.toLowerCase())).size).toBe(BOT_NAMES.length);
  });

  it('are the same for the same key, and differ from the names already taken', () => {
    expect(botName('ABCD:red')).toBe(botName('ABCD:red'));
    const first = botName('ABCD:red');
    expect(botName('ABCD:red', [first.toUpperCase()])).not.toBe(first);
    const taken = [];
    for (let i = 0; i < 4; i++) taken.push(botName(`room:${i}`, taken));
    expect(new Set(taken).size).toBe(4);
  });

  it('still gives a valid name when every name in the list is taken', () => {
    expect(validateName(botName('x', BOT_NAMES)).ok).toBe(true);
  });
});

describe('computer seats in an online room', () => {
  it('show a username, not "Computer", the same every time, different from the people\'s', () => {
    const room = new Room({ code: 'BCDF', seats: 4, clock: new FakeClock(), rng: seeded(1), config: DEFAULT_CONFIG });
    const conn = new FakeConn();
    room.join(conn, null, BOT_NAMES[0]); // a person who happens to have a bot-like name
    for (let i = 0; i < 3; i++) room.handle(room.members.keys().next().value, { t: 'addAi' });
    const seats = () => room.info(null).seats;
    const names = seats().map((s) => s.name);
    expect(names).not.toContain('Computer');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
    expect(seats().map((s) => s.name)).toEqual(names);
    expect(seats().filter((s) => s.kind === 'ai').every((s) => validateName(s.name).ok)).toBe(true);
  });
});
