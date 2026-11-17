import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AVATAR_KEYS, AVATARS } from '../src/config/assets.js';
import { assignAvatars, newAvatarSeed } from '../src/game/avatars.js';

const COLORS = ['red', 'green', 'yellow', 'blue'];
const KEYS = ['avatar-a', 'avatar-b', 'avatar-c', 'avatar-d', 'avatar-e', 'avatar-f', 'avatar-g', 'avatar-h'];

describe('assignAvatars', () => {
  it('gives every player a different avatar from the list', () => {
    for (let i = 0; i < 200; i++) {
      const picked = assignAvatars(COLORS, `seed-${i}`, KEYS);
      expect(Object.keys(picked)).toEqual(COLORS);
      const values = Object.values(picked);
      expect(new Set(values).size, `seed-${i}`).toBe(4);
      for (const v of values) expect(KEYS).toContain(v);
    }
  });

  it('gives the same avatars for the same seed (so every online screen agrees), whatever order the list is in', () => {
    const a = assignAvatars(COLORS, 'BCDF', KEYS);
    expect(assignAvatars(COLORS, 'BCDF', KEYS)).toEqual(a);
    expect(assignAvatars(COLORS, 'BCDF', [...KEYS].reverse())).toEqual(a);
    expect(assignAvatars(COLORS, 'BCDF', KEYS)).toEqual(a);
  });

  it('gives different avatars for different seeds, and uses every avatar over many games', () => {
    const sets = new Set();
    const used = new Set();
    for (let i = 0; i < 300; i++) {
      const picked = assignAvatars(COLORS, `game-${i}`, KEYS);
      sets.add(JSON.stringify(picked));
      for (const v of Object.values(picked)) used.add(v);
    }
    expect(sets.size).toBeGreaterThan(100);
    expect(used.size).toBe(KEYS.length);
  });

  it('gives each colour every avatar about equally often (no favourites)', () => {
    const counts = Object.fromEntries(COLORS.map((c) => [c, Object.fromEntries(KEYS.map((k) => [k, 0]))]));
    const games = 4000;
    for (let i = 0; i < games; i++) for (const [color, key] of Object.entries(assignAvatars(COLORS, `fair-${i}`, KEYS))) counts[color][key]++;
    const expected = games / KEYS.length;
    for (const color of COLORS) for (const key of KEYS) expect(Math.abs(counts[color][key] - expected), `${color} ${key}`).toBeLessThan(expected * 0.2);
  });

  it('works with two or three players, one player, and no avatars at all', () => {
    expect(Object.keys(assignAvatars(['red', 'yellow'], 'x', KEYS))).toEqual(['red', 'yellow']);
    expect(new Set(Object.values(assignAvatars(['red', 'green', 'blue'], 'x', KEYS))).size).toBe(3);
    expect(assignAvatars(['red'], 'x', KEYS)).toEqual({ red: expect.any(String) });
    expect(assignAvatars(COLORS, 'x', [])).toEqual({});
  });

  it('reuses avatars only when there are fewer avatars than players', () => {
    const picked = assignAvatars(COLORS, 'x', ['avatar-a', 'avatar-b']);
    expect(Object.values(picked).every((v) => ['avatar-a', 'avatar-b'].includes(v))).toBe(true);
  });

  it('does not change the list it is given', () => {
    const keys = [...KEYS].reverse();
    const copy = [...keys];
    assignAvatars(COLORS, 'x', keys);
    expect(keys).toEqual(copy);
  });

  it('makes a fresh seed every time', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => newAvatarSeed()));
    expect(seeds.size).toBe(50);
  });
});

describe('the avatar pictures', () => {
  const dir = new URL('../img/avatars-small/', import.meta.url);
  const originals = new URL('../img/avatars/', import.meta.url);

  it('are found in img/avatars-small/, with a unique key each, in a stable order', () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(4); // a game of four needs four different avatars
    expect(new Set(AVATAR_KEYS).size).toBe(AVATAR_KEYS.length);
    expect([...AVATAR_KEYS]).toEqual([...AVATAR_KEYS].sort((a, b) => a.localeCompare(b)));
    for (const { key, url } of AVATARS) {
      expect(key).toMatch(/^avatar-[a-z0-9_-]+$/);
      expect(typeof url).toBe('string');
    }
  });

  it('have a small copy for every picture in img/avatars/ (run `npm run build:avatars` after adding one)', () => {
    const small = new Set(fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png')));
    for (const name of fs.readdirSync(originals).filter((n) => n.toLowerCase().endsWith('.png'))) expect(small.has(name), name).toBe(true);
  });

  it('are real, small PNG files', () => {
    for (const name of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png'))) {
      const file = fs.readFileSync(new URL(name, dir));
      expect(file.readUInt32BE(0), name).toBe(0x89504e47);
      const width = file.readUInt32BE(16);
      expect(width, name).toBeLessThanOrEqual(256);
      expect(file.length, name).toBeLessThan(40_000);
    }
  });
});
