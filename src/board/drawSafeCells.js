import { BOARD_IMAGE } from '../config/assets.js';
import { PICTURE_STAR_CELLS } from '../config/boardPicture.js';
import { CELL, COLORS, PLAYERS } from '../config/constants.js';
import { gridToPixel } from './geometry.js';
import { START_INDEX, STAR_INDICES, trackCellCentre } from '../game/path.js';

// Marks the eight safe cells: a white star on each start cell, a dark star on each star cell. The board picture already has a star on
// some of them (PICTURE_STAR_CELLS); those are left as they are when the picture is shown.
export function drawSafeCells(scene) {
  const hasStar = scene.textures?.exists?.(BOARD_IMAGE)
    ? ({ gx, gy }) => PICTURE_STAR_CELLS.some(([c, r]) => c === Math.floor(gx) && r === Math.floor(gy))
    : () => false;
  const mark = (abs, color) => {
    const cell = trackCellCentre(abs);
    if (hasStar(cell)) return;
    const { x, y } = gridToPixel(cell.gx, cell.gy);
    scene.add.star(x, y, 5, CELL * 0.13, CELL * 0.32, color).setDepth(1);
  };
  for (const p of PLAYERS) mark(START_INDEX[p.id], 0xffffff);
  for (const abs of STAR_INDICES) mark(abs, COLORS.line);
}
