import { CELL } from '../config/constants.js';
import { layout } from '../config/layout.js';
import { PLAYER_IDS } from '../game/path.js';

// The board can be turned in quarter turns, so that the player's own colour is always in the bottom left corner.
// Everything that draws or places something on the board goes through this file, so the turn is applied in one place:
// call setBoardRotation() before drawing, and the board, the tokens, the hints and the stars all follow.
// Grid units: 1 unit = 1 cell, the board is 15 x 15, cell centres are at +0.5.
let quarterTurns = 0; // clockwise

export const setBoardRotation = (turns) => {
  quarterTurns = ((Math.round(turns) % 4) + 4) % 4;
};
export const getBoardRotation = () => quarterTurns;

// How many clockwise quarter turns bring `color`'s yard to the bottom left. The yards are, clockwise from the top left,
// in PLAYER_IDS order (red, green, yellow, blue) and the bottom left is the fourth one.
export const turnsToBottomLeft = (color) => {
  const index = PLAYER_IDS.indexOf(color);
  return index < 0 ? 0 : (3 - index + 4) % 4;
};

// A point of the board after the turn (clockwise about the middle of the board).
export function rotatePoint(gx, gy) {
  let x = gx;
  let y = gy;
  for (let i = 0; i < quarterTurns; i++) [x, y] = [15 - y, x];
  return { x, y };
}

// A direction (no position) after the turn.
export function rotateVector(dx, dy) {
  let x = dx;
  let y = dy;
  for (let i = 0; i < quarterTurns; i++) [x, y] = [-y, x];
  return { x, y };
}

// Convert grid units to canvas pixels (the turn included).
export const gridToPixel = (gx, gy) => {
  const p = rotatePoint(gx, gy);
  return { x: layout.boardX + p.x * CELL, y: layout.boardY + p.y * CELL };
};

// The pixel rectangle { x, y, w, h } of the grid rectangle at (col, row) that is w cells wide and h tall (the turn included).
export function gridRect(col, row, w = 1, h = 1) {
  const a = gridToPixel(col, row);
  const b = gridToPixel(col + w, row + h);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
