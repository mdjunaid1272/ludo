import { afterEach, describe, expect, it } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { getBoardRotation, gridRect, gridToPixel, rotatePoint, rotateVector, setBoardRotation, turnsToBottomLeft } from '../src/board/geometry.js';
import { CELL, PLAYERS } from '../src/config/constants.js';
import { layout } from '../src/config/layout.js';
import { FINISHED, HOME_LANE_CELLS, IN_YARD, PLAYER_IDS, TRACK_CELLS, positionFor } from '../src/game/path.js';

// The board is turned so that the player's own colour is in the bottom left corner (against the computer and online).

const middle = () => ({ x: layout.boardX + 7.5 * CELL, y: layout.boardY + 7.5 * CELL });
const inBottomLeft = (p) => p.x < middle().x && p.y > middle().y;
afterEach(() => setBoardRotation(0));

describe('turning the board', () => {
  it('turns by quarter turns and wraps around', () => {
    setBoardRotation(5);
    expect(getBoardRotation()).toBe(1);
    setBoardRotation(-1);
    expect(getBoardRotation()).toBe(3);
    setBoardRotation(0);
    expect(getBoardRotation()).toBe(0);
  });

  it('does nothing at zero, and four quarter turns bring every point back', () => {
    setBoardRotation(0);
    expect(rotatePoint(3.5, 11.5)).toEqual({ x: 3.5, y: 11.5 });
    for (const turns of [1, 2, 3]) {
      setBoardRotation(turns);
      let p = { x: 3.5, y: 11.5 };
      for (let i = 0; i < 4 / turns; i++) p = rotatePoint(p.x, p.y); // `turns` quarter turns, repeated until a full circle (4 and 2 divide evenly; 3 does 4/3 -> see below)
      if (4 % turns === 0) expect(p.x === 3.5 && p.y === 11.5).toBe(true);
    }
    setBoardRotation(1);
    let p = { x: 3.5, y: 11.5 };
    for (let i = 0; i < 4; i++) p = rotatePoint(p.x, p.y);
    expect(p).toEqual({ x: 3.5, y: 11.5 });
  });

  it('turns clockwise: the top left corner goes to the top right', () => {
    setBoardRotation(1);
    expect(rotatePoint(0, 0)).toEqual({ x: 15, y: 0 });
    expect(rotatePoint(15, 0)).toEqual({ x: 15, y: 15 });
    expect(rotateVector(1, 0)).toEqual({ x: -0, y: 1 }); // pointing right becomes pointing down
  });

  it('keeps cell centres on cell centres, and every cell on its own spot', () => {
    for (const turns of [0, 1, 2, 3]) {
      setBoardRotation(turns);
      const seen = new Set();
      for (let col = 0; col < 15; col++) {
        for (let row = 0; row < 15; row++) {
          const p = rotatePoint(col + 0.5, row + 0.5);
          expect(Number.isInteger(p.x - 0.5) && Number.isInteger(p.y - 0.5), `turn ${turns} cell ${col},${row}`).toBe(true);
          seen.add(`${p.x},${p.y}`);
        }
      }
      expect(seen.size).toBe(225);
    }
  });

  it('keeps the track connected: neighbouring cells stay as far apart as they were, and the home lane stays a straight line', () => {
    // (Some steps at the corners of the cross are diagonal, so compare with the unturned board.)
    const gaps = () => TRACK_CELLS.map((cell, i) => {
      const a = gridToPixel(...cell.map((n) => n + 0.5));
      const b = gridToPixel(...TRACK_CELLS[(i + 1) % TRACK_CELLS.length].map((n) => n + 0.5));
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    setBoardRotation(0);
    const unturned = gaps();
    expect(Math.max(...unturned)).toBeLessThan(CELL * 1.5);
    for (const turns of [0, 1, 2, 3]) {
      setBoardRotation(turns);
      gaps().forEach((gap, i) => expect(gap, `turn ${turns} cell ${i}`).toBeCloseTo(unturned[i], 5));
      for (const id of PLAYER_IDS) {
        const lane = HOME_LANE_CELLS[id].map((c) => gridToPixel(c[0] + 0.5, c[1] + 0.5));
        expect(lane.every((p) => Math.abs(p.x - lane[0].x) < 0.001) || lane.every((p) => Math.abs(p.y - lane[0].y) < 0.001), `${id} lane is straight`).toBe(true);
      }
    }
  });
});

describe('your colour in the bottom left corner', () => {
  it('needs the right number of turns for each colour', () => {
    expect(PLAYER_IDS.map(turnsToBottomLeft)).toEqual([3, 2, 1, 0]); // red, green, yellow, blue (already there)
    expect(turnsToBottomLeft('nonsense')).toBe(0);
  });

  it.each(PLAYER_IDS)('puts the %s yard, its tokens and its home column on the right side of the board', (color) => {
    setBoardRotation(turnsToBottomLeft(color));
    for (let i = 0; i < 4; i++) {
      const { gx, gy } = positionFor(color, IN_YARD, i);
      expect(inBottomLeft(gridToPixel(gx, gy)), `${color} token ${i} in the yard`).toBe(true);
    }
    // The home lane runs from the edge towards the centre, so the finished spot is next to the middle.
    const { gx, gy } = positionFor(color, FINISHED - 1, 0);
    const home = gridToPixel(gx, gy);
    expect(Math.hypot(home.x - middle().x, home.y - middle().y)).toBeLessThanOrEqual(CELL * 2 + 0.001);
  });

  it.each(PLAYER_IDS)('draws the %s yard in the bottom left corner (and no other yard there)', (color) => {
    setBoardRotation(turnsToBottomLeft(color));
    const yards = {};
    let current = null;
    const g = new Proxy({}, {
      get: (_, name) => {
        if (name === 'fillStyle') return (c) => { current = c; return g; };
        if (name === 'fillRect') return (x, y, w, h) => { if (w === CELL * 6 && h === CELL * 6) yards[current] = { x, y }; return g; };
        return () => g;
      },
    });
    drawBoard({ add: { graphics: () => g } }, { makeText: () => ({ setOrigin() { return this; } }) });
    const corner = (id) => yards[PLAYERS.find((p) => p.id === id).color];
    const bottomLeft = PLAYER_IDS.filter((id) => corner(id) && inBottomLeft({ x: corner(id).x + 3 * CELL, y: corner(id).y + 3 * CELL }));
    expect(bottomLeft).toEqual([color]);
  });

  it('gives grid rectangles that stay as big as they were', () => {
    for (const turns of [0, 1, 2, 3]) {
      setBoardRotation(turns);
      const r = gridRect(9, 9, 6, 6);
      expect(r.w).toBe(6 * CELL);
      expect(r.h).toBe(6 * CELL);
      const one = gridRect(3, 4);
      expect(one.w).toBe(CELL);
      expect(one.h).toBe(CELL);
    }
  });
});
