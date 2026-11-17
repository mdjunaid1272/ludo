import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, normalizeSettings, playersFor, summarizeSettings, cycleOption, isDefaultRules,
} from '../src/game/settings.js';
import { createSettingsStore } from '../src/config/settingsStore.js';
import { SETTING_ROWS } from '../src/config/settingsRows.js';
import { DEFAULT_RULES, resolveRules } from '../src/game/rules.js';
import { GameState } from '../src/game/GameState.js';

describe('normalizeSettings', () => {
  it('returns defaults for nothing or junk', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}, { players: 9, rules: 'no' }]) {
      expect(normalizeSettings(raw)).toEqual({ players: 4, localColors: ['red', 'green', 'yellow', 'blue'], difficulty: 'normal', vsPlayers: 2, humanColor: 'red', rules: { ...DEFAULT_RULES } });
    }
  });

  it('keeps valid values and drops unknown or invalid ones individually', () => {
    const s = normalizeSettings({ players: 2, rules: { blockades: true, tripleSix: 'banana', bogus: true, finishGrantsExtra: 'yes' } });
    expect(s.players).toBe(2);
    expect(s.rules).toEqual({ ...DEFAULT_RULES, blockades: true });
  });

  it('always produces rules the engine accepts', () => {
    const s = normalizeSettings({ players: 3, rules: { tripleSix: 'off', blockades: true } });
    expect(() => new GameState({ players: s.localColors, rules: s.rules })).not.toThrow();
  });
});

describe('computer skill setting', () => {
  it('accepts every level and falls back to normal for anything else', () => {
    for (const level of ['easy', 'normal', 'hard']) expect(normalizeSettings({ difficulty: level }).difficulty).toBe(level);
    for (const bad of ['expert', 3, null, undefined, {}]) expect(normalizeSettings({ difficulty: bad }).difficulty).toBe('normal');
  });
});

describe('playersFor and summaries', () => {
  it('seats 2 players opposite and falls back to 4', () => {
    expect(playersFor(2)).toEqual(['red', 'yellow']);
    expect(playersFor(3)).toEqual(['red', 'green', 'yellow']);
    expect(playersFor(4)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(playersFor(7)).toHaveLength(4);
  });

  it('describes default and custom rules', () => {
    expect(summarizeSettings(DEFAULT_SETTINGS)).toBe('4 players - classic rules - computer: normal');
    expect(summarizeSettings({ players: 2, difficulty: 'hard', rules: { ...DEFAULT_RULES, blockades: true } })).toBe('2 players - custom rules - computer: hard');
    expect(isDefaultRules(DEFAULT_RULES)).toBe(true);
  });

  it('cycles through options and wraps', () => {
    expect(cycleOption([2, 3, 4], 2)).toBe(3);
    expect(cycleOption([2, 3, 4], 4)).toBe(2);
    expect(cycleOption([true, false], true)).toBe(false);
    expect(cycleOption([true, false], false)).toBe(true);
    expect(cycleOption(['a', 'b'], 'zzz')).toBe('a');
  });
});

describe('settings rows', () => {
  const base = () => normalizeSettings(null);

  it('has a row for every rule and the player count', () => {
    const ids = SETTING_ROWS.map((r) => r.id).sort();
    expect(ids).toEqual([...Object.keys(DEFAULT_RULES), 'players', 'difficulty'].sort());
  });

  it('reads the current value and writes without mutating', () => {
    for (const row of SETTING_ROWS) {
      const before = base();
      const snapshot = JSON.stringify(before);
      const next = row.write(before, cycleNext(row, row.read(before)));
      expect(JSON.stringify(before), row.id).toBe(snapshot);
      expect(row.read(next), row.id).not.toEqual(row.read(before));
    }
  });

  it('every option of every row produces settings the engine accepts, with a label', () => {
    for (const row of SETTING_ROWS) {
      for (const option of row.options) {
        const s = row.write(base(), option);
        expect(row.read(s)).toBe(option);
        expect(row.format(option)).toMatch(/\S/);
        expect(() => resolveRules(s.rules)).not.toThrow();
        expect(() => new GameState({ players: s.localColors, rules: s.rules })).not.toThrow();
      }
    }
  });
});
const cycleNext = (row, current) => cycleOption(row.options, current);

describe('settings store', () => {
  const memoryStorage = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
  };

  it('round-trips settings', () => {
    const store = createSettingsStore(() => memoryStorage());
    const storage = memoryStorage();
    const s = createSettingsStore(() => storage);
    const custom = { players: 3, localColors: ['green', 'yellow', 'blue'], difficulty: 'hard', vsPlayers: 4, humanColor: 'blue', rules: { ...DEFAULT_RULES, blockades: true, tripleSix: 'off' } };
    expect(s.save(custom)).toBe(true);
    expect(s.load()).toEqual(custom);
    expect(store.load()).toEqual(normalizeSettings(null));
  });

  it('survives corrupt stored data', () => {
    const storage = memoryStorage();
    storage.setItem('ludo.settings.v2', '{not json');
    expect(createSettingsStore(() => storage).load()).toEqual(normalizeSettings(null));
  });

  it('works when storage is missing or throws', () => {
    const throwing = () => { throw new Error('blocked'); };
    for (const getStorage of [() => undefined, throwing, () => ({ getItem: throwing, setItem: throwing, removeItem: throwing })]) {
      const s = createSettingsStore(getStorage);
      expect(s.load()).toEqual(normalizeSettings(null));
      expect(s.save(DEFAULT_SETTINGS)).toBe(false);
      expect(s.reset()).toEqual(normalizeSettings(null));
    }
  });

  it('reset clears saved values', () => {
    const storage = memoryStorage();
    const s = createSettingsStore(() => storage);
    s.save({ players: 2, rules: DEFAULT_RULES });
    expect(s.reset()).toEqual(normalizeSettings(null));
    expect(s.load().players).toBe(4);
  });
});



