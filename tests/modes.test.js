import { describe, it, expect } from 'vitest';
import { computersFor, playersFor, seatsFor, normalizeSettings, localSeatsFor, isValidColorSet, PLAYER_COUNTS } from '../src/game/settings.js';
import { SETTING_ROWS } from '../src/config/settingsRows.js';
import { PLAYER_IDS } from '../src/game/path.js';
import { GameState } from '../src/game/GameState.js';

describe('computersFor', () => {
  it('has no computers in local multiplayer', () => {
    for (const n of [2, 3, 4]) expect(computersFor('local', playersFor(n))).toEqual([]);
    expect(computersFor(undefined, playersFor(4))).toEqual([]);
  });

  it('leaves the first seat to the person and gives the computer every other seat', () => {
    expect(computersFor('computer', playersFor(4))).toEqual(['green', 'yellow', 'blue']);
    expect(computersFor('computer', playersFor(3))).toEqual(['green', 'yellow']);
    expect(computersFor('computer', playersFor(2))).toEqual(['yellow']);
  });

  it('always leaves exactly one person, whatever colour they chose', () => {
    for (const n of PLAYER_COUNTS) {
      for (const color of PLAYER_IDS) {
        const seats = seatsFor(n, color);
        const computers = computersFor('computer', seats);
        expect(seats.length - computers.length).toBe(1);
        expect(computers).not.toContain(color);
      }
    }
  });
});

describe('seatsFor (Player vs Computer seating)', () => {
  it('seats the person first, so they move first', () => {
    for (const n of PLAYER_COUNTS) for (const color of PLAYER_IDS) expect(seatsFor(n, color)[0]).toBe(color);
  });

  it('gives the requested number of distinct colours in clockwise order', () => {
    for (const n of PLAYER_COUNTS) {
      for (const color of PLAYER_IDS) {
        const seats = seatsFor(n, color);
        expect(seats).toHaveLength(n);
        expect(new Set(seats).size).toBe(n);
        // Turn order follows the board clockwise: each seat is later in the red-green-yellow-blue cycle.
        const pos = seats.map((s) => PLAYER_IDS.indexOf(s));
        for (let i = 1; i < pos.length; i++) expect((pos[i] - pos[i - 1] + 4) % 4).toBeGreaterThan(0);
      }
    }
  });

  it('seats two players opposite each other', () => {
    expect(seatsFor(2, 'red')).toEqual(['red', 'yellow']);
    expect(seatsFor(2, 'green')).toEqual(['green', 'blue']);
    expect(seatsFor(2, 'yellow')).toEqual(['yellow', 'red']);
    expect(seatsFor(2, 'blue')).toEqual(['blue', 'green']);
  });

  it('matches the documented 3- and 4-player seatings', () => {
    expect(seatsFor(3, 'blue')).toEqual(['blue', 'red', 'green']);
    expect(seatsFor(4, 'yellow')).toEqual(['yellow', 'blue', 'red', 'green']);
  });

  it('produces a seating the game engine accepts, for every choice', () => {
    for (const n of PLAYER_COUNTS) for (const color of PLAYER_IDS) expect(() => new GameState({ players: seatsFor(n, color) })).not.toThrow();
  });

  it('rejects a nonsense setup', () => {
    expect(() => seatsFor(5, 'red')).toThrow();
    expect(() => seatsFor(2, 'purple')).toThrow();
    expect(() => seatsFor(undefined, 'red')).toThrow();
  });
});

describe('remembering the last Player vs Computer setup', () => {
  it('defaults to 2 players as red', () => {
    const s = normalizeSettings(null);
    expect([s.vsPlayers, s.humanColor]).toEqual([2, 'red']);
  });

  it('keeps valid values and ignores invalid ones', () => {
    expect(normalizeSettings({ vsPlayers: 3, humanColor: 'blue' })).toMatchObject({ vsPlayers: 3, humanColor: 'blue' });
    expect(normalizeSettings({ vsPlayers: 9, humanColor: 'pink' })).toMatchObject({ vsPlayers: 2, humanColor: 'red' });
  });
});

describe('local multiplayer colour selection', () => {
  it('accepts 2-4 distinct valid colours only', () => {
    expect(isValidColorSet(['red', 'blue'])).toBe(true);
    expect(isValidColorSet(['red', 'green', 'yellow', 'blue'])).toBe(true);
    for (const bad of [[], ['red'], ['red', 'red'], ['red', 'pink'], ['red', 'green', 'yellow', 'blue', 'red'], 'red', null, undefined, [1, 2]]) {
      expect(isValidColorSet(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('seats the chosen colours clockwise round the board, whatever order they were picked in', () => {
    expect(localSeatsFor(['blue', 'green'])).toEqual(['green', 'blue']);
    expect(localSeatsFor(['yellow', 'red', 'blue'])).toEqual(['red', 'yellow', 'blue']);
    expect(localSeatsFor(['blue', 'yellow', 'green', 'red'])).toEqual(['red', 'green', 'yellow', 'blue']);
  });

  it('rejects an invalid selection', () => {
    expect(() => localSeatsFor(['red'])).toThrow();
    expect(() => localSeatsFor(['red', 'red'])).toThrow();
  });

  it('produces seatings the engine accepts, for every possible choice of colours', () => {
    const ids = ['red', 'green', 'yellow', 'blue'];
    for (let mask = 1; mask < 16; mask++) {
      const colors = ids.filter((_, i) => mask & (1 << i));
      if (!isValidColorSet(colors)) continue;
      expect(() => new GameState({ players: localSeatsFor(colors) }), colors.join()).not.toThrow();
    }
  });

  it('remembers the colours, and keeps the player count equal to how many were chosen', () => {
    const s = normalizeSettings({ players: 4, localColors: ['green', 'blue'] });
    expect(s.localColors).toEqual(['green', 'blue']);
    expect(s.players).toBe(2); // the colours are authoritative
  });

  it('falls back to the default set for the count when the saved colours are missing or invalid', () => {
    expect(normalizeSettings({ players: 3 }).localColors).toEqual(['red', 'green', 'yellow']);
    expect(normalizeSettings({ players: 2, localColors: ['red'] }).localColors).toEqual(['red', 'yellow']);
    expect(normalizeSettings({ localColors: 'x' }).localColors).toEqual(['red', 'green', 'yellow', 'blue']);
  });

  it('the Settings "Players" row resets the colours to that count\'s default set', () => {
    const row = SETTING_ROWS.find((r) => r.id === 'players');
    const next = row.write(normalizeSettings({ localColors: ['green', 'blue'] }), 3);
    expect(next.players).toBe(3);
    expect(next.localColors).toEqual(['red', 'green', 'yellow']);
  });
});
