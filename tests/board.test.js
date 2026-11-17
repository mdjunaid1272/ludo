import { describe, it, expect } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { gridToPixel } from '../src/board/geometry.js';
import { CELL, COLORS } from '../src/config/constants.js';
import { HOME_LANE_CELLS, START_INDEX, TRACK_CELLS, PLAYER_IDS, IN_YARD, positionFor } from '../src/game/path.js';

// A recording stand-in for a Phaser scene: remembers every fill with the colour it used.
function recordDrawing() {
  const fills = [];
  let color = null;
  const g = new Proxy({}, {
    get: (_, name) => {
      if (name === 'fillStyle') return (c) => { color = c; return g; };
      if (name === 'fillRect') return (x, y, w, h) => { fills.push({ shape: 'rect', color, x, y, w, h }); return g; };
      if (name === 'fillCircle') return (x, y, r) => { fills.push({ shape: 'circle', color, x, y, r }); return g; };
      return () => g;
    },
  });
  // The yard names are drawn with the picture font, which needs a real Phaser scene; here they are stand-ins.
  const makeText = () => ({ setOrigin() { return this; } });
  drawBoard({ add: { graphics: () => g } }, { makeText });
  return fills;
}

describe('drawn board matches the game logic', () => {
  const fills = recordDrawing();

  it('paints each colour home column and start cell with that colour', () => {
    for (const id of PLAYER_IDS) {
      const cells = [...HOME_LANE_CELLS[id], TRACK_CELLS[START_INDEX[id]]];
      for (const [c, r] of cells) {
        const { x, y } = gridToPixel(c, r);
        const hit = fills.filter((f) => f.shape === 'rect' && f.x === x && f.y === y && f.w === CELL && f.h === CELL);
        expect(hit.at(-1)?.color, `${id} cell ${c},${r}`).toBe(COLORS[id]);
      }
    }
  });

  it('draws the four yard spots exactly where tokens rest in the yard', () => {
    for (const id of PLAYER_IDS) {
      for (let i = 0; i < 4; i++) {
        const { gx, gy } = positionFor(id, IN_YARD, i);
        const { x, y } = gridToPixel(gx, gy);
        const spot = fills.find((f) => f.shape === 'circle' && f.x === x && f.y === y);
        expect(spot?.color, `${id} spot ${i}`).toBe(COLORS[id]);
      }
    }
  });
});
