import { CELL, COLORS, PLAYERS } from '../config/constants.js';
import { gridToPixel } from './geometry.js';
import { START_INDEX, STAR_INDICES, trackCellCentre } from '../game/path.js';

// Marks the eight safe cells: a white star on each start cell, a dark star on each star cell.
export function drawSafeCells(scene) {
  const mark = (abs, color) => {
    const { gx, gy } = trackCellCentre(abs);
    const { x, y } = gridToPixel(gx, gy);
    scene.add.star(x, y, 5, CELL * 0.13, CELL * 0.32, color).setDepth(1);
  };
  for (const p of PLAYERS) mark(START_INDEX[p.id], 0xffffff);
  for (const abs of STAR_INDICES) mark(abs, COLORS.line);
}
