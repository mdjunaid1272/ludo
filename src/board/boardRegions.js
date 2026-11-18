import { BOARD_MARGIN_CELLS, PICTURE_CELLS } from '../config/boardPicture.js';
import { HOME_LANE_CELLS, START_INDEX, TRACK_CELLS, YARD_CORNER } from '../game/path.js';
import { REGION_ANY, regionOfFamily } from './recolor.js';

// Where each colour lives in the board picture (img/elements/board.png), as a code per pixel for recolor(): a colour's yard panel, its
// home column and start cell, and the middle of the board. The rest of the picture (water, grass, stone, the gold frames and the
// white cells) is never repainted, so another colour map only changes the colours of the players.
// `size` is the picture's width and height in pixels; the picture shows BOARD_MARGIN_CELLS of extra margin round the 15 x 15 cells.
const YARD_PANEL = [0.7, 5.0]; // the panel inside the gold frame, in cells from the yard's corner

export function boardRegions(size) {
  const regions = new Uint8Array(size * size);
  const perCell = size / PICTURE_CELLS;
  const fill = (x0, y0, x1, y1, code) => { // a rectangle in cells (the grid's top left is 0, 0)
    const px0 = Math.max(0, Math.round((x0 + BOARD_MARGIN_CELLS) * perCell));
    const px1 = Math.min(size, Math.round((x1 + BOARD_MARGIN_CELLS) * perCell));
    const py0 = Math.max(0, Math.round((y0 + BOARD_MARGIN_CELLS) * perCell));
    const py1 = Math.min(size, Math.round((y1 + BOARD_MARGIN_CELLS) * perCell));
    for (let y = py0; y < py1; y++) regions.fill(code, y * size + px0, y * size + px1);
  };
  for (const seat of Object.keys(START_INDEX)) {
    const code = regionOfFamily(seat);
    const [corner, row] = YARD_CORNER[seat];
    fill(corner + YARD_PANEL[0], row + YARD_PANEL[0], corner + YARD_PANEL[1], row + YARD_PANEL[1], code);
    for (const [c, r] of [...HOME_LANE_CELLS[seat], TRACK_CELLS[START_INDEX[seat]]]) fill(c, r, c + 1, r + 1, code);
  }
  fill(6, 6, 9, 9, REGION_ANY);
  return regions;
}
