import { describe, it, expect } from 'vitest';
import { computeTokenSlots, tokenKey } from '../src/game/tokenLayout.js';
import { positionFor, START_INDEX, FINISHED } from '../src/game/path.js';

const yard = () => [-1, -1, -1, -1];
const all = (overrides = {}) => ({ red: yard(), green: yard(), yellow: yard(), blue: yard(), ...overrides });
const dist = (a, b) => Math.hypot(a.gx - b.gx, a.gy - b.gy);

describe('computeTokenSlots', () => {
  it('gives every token a slot: 16 for four players', () => {
    expect(computeTokenSlots(all()).size).toBe(16);
  });

  it('keeps yard tokens at their own yard spots at full size', () => {
    const slots = computeTokenSlots(all());
    for (const id of ['red', 'green', 'yellow', 'blue']) {
      for (let i = 0; i < 4; i++) {
        const { gx, gy, scale } = slots.get(tokenKey(id, i));
        expect({ gx, gy }).toEqual(positionFor(id, -1, i));
        expect(scale).toBe(1);
      }
    }
  });

  it('places a lone token exactly on its cell at full size', () => {
    const slot = computeTokenSlots(all({ red: [4, -1, -1, -1] })).get(tokenKey('red', 0));
    expect(slot).toEqual({ ...positionFor('red', 4, 0), scale: 1 });
  });

  it('shrinks and fans out tokens sharing a cell, keeping the group centred on the cell', () => {
    for (const n of [2, 3, 4]) {
      const progress = [7, 7, 7, 7].map((p, i) => (i < n ? p : -1));
      const slots = computeTokenSlots(all({ red: progress }));
      const group = [0, 1, 2, 3].slice(0, n).map((i) => slots.get(tokenKey('red', i)));
      const cell = positionFor('red', 7, 0);
      const scale = n === 2 ? 0.75 : 0.62;
      for (const s of group) {
        expect(s.scale).toBe(scale);
        expect(dist(s, cell)).toBeCloseTo(0.2, 6);
      }
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(dist(group[a], group[b])).toBeGreaterThan(0.1);
      expect(group.reduce((sum, s) => sum + s.gx, 0) / n).toBeCloseTo(cell.gx, 6);
      expect(group.reduce((sum, s) => sum + s.gy, 0) / n).toBeCloseTo(cell.gy, 6);
    }
  });

  it('groups tokens of different colours that share a cell', () => {
    const greenOnRed3 = (3 - START_INDEX.green + 52) % 52;
    const slots = computeTokenSlots(all({ red: [3, -1, -1, -1], green: [greenOnRed3, -1, -1, -1] }));
    expect(slots.get(tokenKey('red', 0)).scale).toBe(0.75);
    expect(slots.get(tokenKey('green', 0)).scale).toBe(0.75);
  });

  it('does not group tokens on different cells', () => {
    const slots = computeTokenSlots(all({ red: [3, 4, -1, -1] }));
    expect(slots.get(tokenKey('red', 0)).scale).toBe(1);
    expect(slots.get(tokenKey('red', 1)).scale).toBe(1);
  });

  it('never stacks finished tokens or yard tokens (they have their own spots)', () => {
    const slots = computeTokenSlots(all({ red: [FINISHED, FINISHED, FINISHED, FINISHED] }));
    for (let i = 0; i < 4; i++) expect(slots.get(tokenKey('red', i)).scale).toBe(1);
    const spots = new Set([0, 1, 2, 3].map((i) => JSON.stringify(slots.get(tokenKey('red', i)))));
    expect(spots.size).toBe(4);
  });

  it('works for two-player games', () => {
    expect(computeTokenSlots({ red: yard(), yellow: yard() }).size).toBe(8);
  });
});
