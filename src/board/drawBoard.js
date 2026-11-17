import { CELL, COLORS, PLAYERS } from '../config/constants.js';
import { HOME_LANE_CELLS, START_INDEX, TRACK_CELLS, YARD_CORNER, YARD_OFFSETS } from '../game/path.js';
import { IDENTITY_PALETTE } from '../config/palette.js';
import { addText } from '../ui/SpriteText.js';
import { gridRect, gridToPixel, rotateVector } from './geometry.js';

// Draws a static 15x15 Ludo board: four yards, cross-shaped track, home column and centre. The board may be turned in
// quarter turns (see geometry.js): everything here is placed through the grid helpers, so the turn is applied to it all.
// Yards of colours that are not playing (activePlayers) are dimmed. The palette says which colour and name each seat is
// painted in on this screen (online games show everybody's own choice, see game/perspective.js); positions never change.
export function drawBoard(scene, { activePlayers = PLAYERS.map((p) => p.id), makeText = addText, palette = IDENTITY_PALETTE } = {}) {
  const g = scene.add.graphics();
  const fillCells = (col, row, w = 1, h = 1) => {
    const r = gridRect(col, row, w, h);
    g.fillRect(r.x, r.y, r.w, r.h);
  };

  // White base for the whole board.
  g.fillStyle(COLORS.cell, 1);
  fillCells(0, 0, 15, 15);

  // Home columns and start cells, taken from the same data the game logic uses.
  for (const seat of PLAYERS) {
    g.fillStyle(palette.color(seat.id), 1);
    for (const [c, r] of [...HOME_LANE_CELLS[seat.id], TRACK_CELLS[START_INDEX[seat.id]]]) fillCells(c, r);
  }
  // Yards, one per player, each with a white panel and four token spots.
  for (const seat of PLAYERS) {
    const p = palette.entry(seat.id);
    const [corner, row] = YARD_CORNER[p.id];
    g.fillStyle(p.color, 1);
    fillCells(corner, row, 6, 6);
    const panel = gridRect(corner + 1, row + 1, 4, 4);
    g.fillStyle(0xffffff, 1).fillRoundedRect(panel.x, panel.y, panel.w, panel.h, 16);
    g.fillStyle(p.color, 1);
    for (const [dx, dy] of YARD_OFFSETS) {
      const c = gridToPixel(corner + dx, row + dy);
      g.fillCircle(c.x, c.y, CELL * 0.4);
    }
    if (!activePlayers.includes(p.id)) {
      g.fillStyle(0x1b1f2a, 0.6);
      fillCells(corner, row, 6, 6);
    }
    // The name sits on the top edge of the yard as it appears on screen (at a quarter turn the grid's top edge would be a side).
    const yard = gridRect(corner, row, 6, 6);
    makeText(scene, yard.x + yard.w / 2, yard.y + CELL * 0.5, p.label, { fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
  }

  // Centre: four coloured triangles meeting at the middle.
  const c = gridToPixel(7.5, 7.5);
  const tl = gridToPixel(6, 6), tr = gridToPixel(9, 6), br = gridToPixel(9, 9), bl = gridToPixel(6, 9);
  g.fillStyle(palette.color('red'), 1).fillTriangle(tl.x, tl.y, bl.x, bl.y, c.x, c.y);
  g.fillStyle(palette.color('green'), 1).fillTriangle(tl.x, tl.y, tr.x, tr.y, c.x, c.y);
  g.fillStyle(palette.color('yellow'), 1).fillTriangle(tr.x, tr.y, br.x, br.y, c.x, c.y);
  g.fillStyle(palette.color('blue'), 1).fillTriangle(bl.x, bl.y, br.x, br.y, c.x, c.y);

  // White arrows at the entrance of each home column, pointing towards the centre.
  g.fillStyle(0xffffff, 0.9);
  for (const p of PLAYERS) {
    const [[c0, r0], [c1, r1]] = HOME_LANE_CELLS[p.id];
    const d = rotateVector(c1 - c0, r1 - r0);
    const m = gridToPixel(c0 + 0.5, r0 + 0.5);
    const s = CELL * 0.22;
    g.fillTriangle(m.x + d.x * s * 1.2, m.y + d.y * s * 1.2, m.x - d.x * s * 0.6 - d.y * s, m.y - d.y * s * 0.6 + d.x * s, m.x - d.x * s * 0.6 + d.y * s, m.y - d.y * s * 0.6 - d.x * s);
  }

  // Centre emblem.
  g.fillStyle(0xffffff, 1).fillCircle(c.x, c.y, CELL * 0.22);

  // Outline every track cell (the cross arms, excluding the centre).
  g.lineStyle(1, COLORS.line, 1);
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const inCross = (col >= 6 && col <= 8) || (row >= 6 && row <= 8);
      const inCentre = col >= 6 && col <= 8 && row >= 6 && row <= 8;
      if (!inCross || inCentre) continue;
      const r = gridRect(col, row);
      g.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
  const board = gridRect(0, 0, 15, 15);
  g.lineStyle(3, COLORS.line, 1).strokeRect(board.x, board.y, board.w, board.h);
  return g;
}
