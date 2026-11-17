import { describe, it, expect } from 'vitest';
import {
  TRACK_CELLS, TRACK_LENGTH, START_INDEX, STAR_INDICES, SAFE_INDICES, HOME_LANE_CELLS, HOME_SPOT,
  YARD_CORNER, YARD_OFFSETS, PLAYER_IDS, IN_YARD, FINISHED, positionFor, absIndexFor,
} from '../src/game/path.js';

const key = ([c, r]) => `${c},${r}`;
const inCentre = ([c, r]) => c >= 6 && c <= 8 && r >= 6 && r <= 8;
const inCross = ([c, r]) => (c >= 6 && c <= 8) || (r >= 6 && r <= 8);
// 90 degrees clockwise about the board centre, for a cell and for a grid point.
const rotateCell = ([c, r]) => [14 - r, c];
const rotatePoint = ({ gx, gy }) => ({ gx: 15 - gy, gy: gx });
const next = (id) => PLAYER_IDS[(PLAYER_IDS.indexOf(id) + 1) % 4];

describe('shared track', () => {
  it('has 52 distinct cells, all on the cross and outside the centre', () => {
    expect(TRACK_LENGTH).toBe(52);
    expect(new Set(TRACK_CELLS.map(key)).size).toBe(52);
    for (const cell of TRACK_CELLS) {
      expect(inCross(cell), key(cell)).toBe(true);
      expect(inCentre(cell), key(cell)).toBe(false);
    }
  });

  it('is a closed loop where each step moves one cell (or turns a corner diagonally)', () => {
    TRACK_CELLS.forEach((cell, i) => {
      const nxt = TRACK_CELLS[(i + 1) % 52];
      const dx = Math.abs(cell[0] - nxt[0]);
      const dy = Math.abs(cell[1] - nxt[1]);
      expect(dx + dy === 1 || (dx === 1 && dy === 1), `step ${i}`).toBe(true);
    });
  });

  it('has 4-fold rotational symmetry (each colour is the previous one turned 90 degrees)', () => {
    for (let i = 0; i < 52; i++) {
      expect(TRACK_CELLS[(i + 13) % 52]).toEqual(rotateCell(TRACK_CELLS[i]));
    }
  });
});

describe('safe cells', () => {
  it('are the four start cells plus the star cell 8 steps after each', () => {
    expect(SAFE_INDICES.size).toBe(8);
    for (const id of PLAYER_IDS) {
      expect(SAFE_INDICES.has(START_INDEX[id])).toBe(true);
      expect(STAR_INDICES).toContain(START_INDEX[id] + 8);
    }
  });
});

describe('home columns and finish', () => {
  it('have five distinct cells per colour, off the shared track', () => {
    const track = new Set(TRACK_CELLS.map(key));
    const all = [];
    for (const id of PLAYER_IDS) {
      expect(HOME_LANE_CELLS[id]).toHaveLength(5);
      for (const cell of HOME_LANE_CELLS[id]) {
        expect(track.has(key(cell))).toBe(false);
        all.push(key(cell));
      }
    }
    expect(new Set(all).size).toBe(20);
  });

  it('form a straight chain that starts next to the last track cell and ends at the centre', () => {
    for (const id of PLAYER_IDS) {
      const lane = HOME_LANE_CELLS[id];
      const lastTrack = TRACK_CELLS[(START_INDEX[id] + 50) % 52];
      const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
      expect(adjacent(lastTrack, lane[0]), `${id} entry`).toBe(true);
      for (let i = 1; i < 5; i++) expect(adjacent(lane[i - 1], lane[i]), `${id} lane ${i}`).toBe(true);
      const end = lane[4];
      const touchesCentre = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inCentre([end[0] + dx, end[1] + dy]));
      expect(touchesCentre, `${id} lane end`).toBe(true);
    }
  });

  it('are the previous colour rotated 90 degrees', () => {
    for (const id of PLAYER_IDS) {
      expect(HOME_LANE_CELLS[next(id)]).toEqual(HOME_LANE_CELLS[id].map(rotateCell));
    }
  });
});

describe('positionFor', () => {
  it('gives every progress value of a colour a distinct, continuous position', () => {
    for (const id of PLAYER_IDS) {
      const seen = new Set();
      for (let p = 0; p < FINISHED; p++) {
        const a = positionFor(id, p, 0);
        const k = `${a.gx},${a.gy}`;
        expect(seen.has(k), `${id} duplicate at ${p}`).toBe(false);
        seen.add(k);
        if (p > 0) {
          const b = positionFor(id, p - 1, 0);
          const dx = Math.abs(a.gx - b.gx);
          const dy = Math.abs(a.gy - b.gy);
          expect(dx <= 1.001 && dy <= 1.001 && dx + dy <= 2.001, `${id} step ${p}`).toBe(true);
        }
      }
    }
  });

  it('puts progress 0 on the colour start cell and 51-55 on its home column', () => {
    for (const id of PLAYER_IDS) {
      const [sc, sr] = TRACK_CELLS[START_INDEX[id]];
      expect(positionFor(id, 0, 0)).toEqual({ gx: sc + 0.5, gy: sr + 0.5 });
      HOME_LANE_CELLS[id].forEach(([c, r], i) => {
        expect(positionFor(id, 51 + i, 0)).toEqual({ gx: c + 0.5, gy: r + 0.5 });
      });
    }
  });

  it('places yard spots inside the colour yard and finished tokens inside the centre', () => {
    for (const id of PLAYER_IDS) {
      const [cc, cr] = YARD_CORNER[id];
      expect(YARD_OFFSETS).toHaveLength(4);
      const spots = [0, 1, 2, 3].map((i) => positionFor(id, IN_YARD, i));
      expect(new Set(spots.map((s) => `${s.gx},${s.gy}`)).size).toBe(4);
      for (const { gx, gy } of spots) {
        expect(gx > cc && gx < cc + 6 && gy > cr && gy < cr + 6, `${id} yard`).toBe(true);
      }
      const homes = [0, 1, 2, 3].map((i) => positionFor(id, FINISHED, i));
      expect(new Set(homes.map((s) => `${s.gx},${s.gy}`)).size).toBe(4);
      for (const { gx, gy } of homes) expect(gx > 6 && gx < 9 && gy > 6 && gy < 9, `${id} home`).toBe(true);
      expect(HOME_SPOT[id]).toBeDefined();
    }
  });

  it('has yards and finishing spots that are the previous colour rotated 90 degrees', () => {
    for (const id of PLAYER_IDS) {
      for (const p of [IN_YARD, FINISHED]) {
        for (let i = 0; i < 4; i++) {
          const rotated = rotatePoint(positionFor(id, p, i));
          const targets = [0, 1, 2, 3].map((j) => positionFor(next(id), p, j));
          expect(
            targets.some((t) => Math.abs(t.gx - rotated.gx) < 1e-9 && Math.abs(t.gy - rotated.gy) < 1e-9),
            `${id} p=${p} token ${i}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('absIndexFor', () => {
  it('maps track progress onto the shared 52-cell loop with wrap-around', () => {
    expect(absIndexFor('red', 0)).toBe(0);
    expect(absIndexFor('red', 50)).toBe(50);
    expect(absIndexFor('green', 0)).toBe(13);
    expect(absIndexFor('green', 40)).toBe(1);
    expect(absIndexFor('blue', 50)).toBe(37);
  });

  it('is null when the token is not on the shared track', () => {
    for (const id of PLAYER_IDS) {
      for (const p of [IN_YARD, 51, 55, FINISHED]) expect(absIndexFor(id, p)).toBeNull();
    }
  });
});

