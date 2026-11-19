import fs from 'node:fs';
import { BOARD_MARGIN_CELLS } from '../src/config/boardPicture.js';
import { POPUPS, POPUP_MADE_WIDTH } from '../src/config/setupPopup.js';
import { decodePng, downscale, encodePng } from './png.mjs';

// Prepares the pictures in img/elements for the game (npm run build:elements). The originals stay as they are; the game loads
// the files made here:
//   board.png        the board (from ludo-board3.png), turned a quarter so the colours sit in the game's corners, and warped so that every
//                    cell is exactly the same size and the 15 x 15 cells fill the picture (the artwork's cells vary a little in size and
//                    the grid is not centred in it, which the game's square grid cannot follow). A small margin of the artwork round the
//                    grid is kept (BOARD_MARGIN_CELLS), so the yards' rims are not cut off.
//   board-top.png, board-bottom.png   the water of ludo-board3.png above and below the board, as it is in the artwork (not turned or
//                    warped), as wide as board.png; the edge next to the board fades out, over the margin, into board.png
//   setup-popup.png, setup-popup-local.png   the "How many players?" popups of Player vs Computer and Local Multiplayer from img/UI boards,
//                    cut to a fixed rectangle and scaled (src/config/setupPopup.js)
//   dice.png         the six faces of the die from dice-sheet.png, in a sheet of 3 x 2 cells of 128 px (faces 1 2 3 on the top row, 4 5 6 below),
//                    each cropped to the die and made the same size, centred in its cell
//   token-<colour>.png   the four pieces, cropped to the piece and made small (they are drawn about 40 px wide)
//   bg-small.png     the background (from bg2.png) at half size
const DIR = new URL('../img/elements/', import.meta.url);
const read = (name) => decodePng(fs.readFileSync(new URL(name, DIR)));
const write = (name, image) => {
  fs.writeFileSync(new URL(name, DIR), encodePng(image));
  console.log(`${name}: ${image.width} x ${image.height}, ${Math.round(fs.statSync(new URL(name, DIR)).size / 1024)} KB`);
};

// --- the board -----------------------------------------------------------------------------------------------------------
// ludo-board3.png has green top left, orange top right, blue bottom right and red bottom left. The game has red top left, then green,
// yellow and blue clockwise, so the picture is turned a quarter clockwise first. These are where the 16 grid lines are in the TURNED picture
// (1283 x 1226), in its pixels, measured from the stone tiles (see docs/ASSETS.md).
const XS = [86, 174, 255, 333, 409, 486, 558, 639, 717, 792, 871, 949, 1029, 1109, 1191, 1269];
const YS = [24, 104, 184, 261, 336, 410, 473, 555, 642, 724, 798, 875, 953, 1035, 1116, 1199];
const CELL_PX = 64; // pixels per cell in the made picture

// ludo-board3.png (1226 x 2212) is a board (1226 x 1283) standing on a taller canvas of water: the board starts BOARD3_TOP rows down.
// The board is cut out of it for board.png; the water above and below it becomes the two strips.
const BOARD3_TOP = 468;
const BOARD3_ROWS = 1283;
const EDGE_ROWS = 4; // the artwork's outermost rows are partly see-through, they are left out
function cropRows(src, top, rows) {
  return { width: src.width, height: rows, pixels: Buffer.from(src.pixels.subarray(top * src.width * 4, (top + rows) * src.width * 4)) };
}

// The picture turned a quarter clockwise: pixel (x, y) of the result is pixel (y, height - 1 - x) of the original.
function turnClockwise(src) {
  const width = src.height;
  const height = src.width;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((src.height - 1 - x) * src.width + y) * 4;
      const to = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) pixels[to + c] = src.pixels[from + c];
    }
  }
  return { width, height, pixels };
}

function bilinear(src, x, y) {
  const x0 = Math.max(0, Math.min(src.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(src.height - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const p = (xx, yy) => src.pixels[(yy * src.width + xx) * 4 + c];
    out[c] = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
  }
  return out;
}

function buildBoard() {
  const src = turnClockwise(cropRows(read('ludo-board3.png'), BOARD3_TOP, BOARD3_ROWS));
  const margin = Math.round(BOARD_MARGIN_CELLS * CELL_PX);
  const size = CELL_PX * 15 + 2 * margin;
  const pixels = Buffer.alloc(size * size * 4);
  // Each output cell is filled from the matching cell of the artwork (stretched a little to fit). The margin continues the first and
  // last cell's size outwards.
  const mapAxis = (v, L) => {
    const g = v - margin; // position on the grid, in output pixels
    if (g < 0) return L[0] + ((g + 0.5) / CELL_PX) * (L[1] - L[0]);
    if (g >= CELL_PX * 15) return L[15] + ((g - CELL_PX * 15 + 0.5) / CELL_PX) * (L[15] - L[14]);
    const cell = Math.min(14, Math.floor(g / CELL_PX));
    const t = (g - cell * CELL_PX + 0.5) / CELL_PX;
    return L[cell] + (L[cell + 1] - L[cell]) * t;
  };
  const sx = Array.from({ length: size }, (_, v) => mapAxis(v, XS));
  const sy = Array.from({ length: size }, (_, v) => mapAxis(v, YS));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = bilinear(src, sx[x], sy[y]);
      const i = (y * size + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255; // (the artwork has a few see-through pixels at its very edges)
  write('board.png', { width: size, height: size, pixels });
}

// The water above and below the board: cut from the artwork, made as wide as board.png, and faded out at the edge next to the board
// (over the margin of board.png) so it joins the picture without a seam.
function buildStrips() {
  const full = read('ludo-board3.png');
  const size = CELL_PX * 15 + 2 * Math.round(BOARD_MARGIN_CELLS * CELL_PX);
  const fade = Math.round(BOARD_MARGIN_CELLS * CELL_PX);
  const scale = size / full.width;
  const make = (name, top, rows, fadeAtBottom) => {
    const strip = downscale(cropRows(full, top, rows), scale);
    for (let y = 0; y < strip.height; y++) {
      const distance = fadeAtBottom ? strip.height - 1 - y : y; // rows from the edge next to the board
      const alpha = distance < fade ? (distance + 0.5) / fade : 1;
      for (let x = 0; x < strip.width; x++) strip.pixels[(y * strip.width + x) * 4 + 3] = Math.round(255 * alpha);
    }
    write(name, strip);
  };
  make('board-top.png', EDGE_ROWS, BOARD3_TOP - EDGE_ROWS, true);
  make('board-bottom.png', BOARD3_TOP + BOARD3_ROWS, full.height - EDGE_ROWS - (BOARD3_TOP + BOARD3_ROWS), false);
}

// --- the setup popup ---------------------------------------------------------------------------------------------------
function buildSetupPopups() {
  for (const { source, name, crop: { x, y, w, h } } of Object.values(POPUPS)) {
    const src = read(source);
    const crop = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++) src.pixels.copy(crop, row * w * 4, ((y + row) * src.width + x) * 4, ((y + row) * src.width + x + w) * 4);
    write(name, downscale({ width: w, height: h, pixels: crop }, POPUP_MADE_WIDTH / w));
  }
}

// --- the die ------------------------------------------------------------------------------------------------------------
const DIE_CELL = 128; // the size of one face's cell in the made sheet
const DIE_PX = 118; // the width the die is made, inside its cell

function buildDice() {
  const sheet = read('dice-sheet.png'); // six dice in two rows of three, on a see-through background
  const cellW = sheet.width / 3;
  const cellH = sheet.height / 2;
  const out = Buffer.alloc(DIE_CELL * 3 * DIE_CELL * 2 * 4);
  for (let face = 0; face < 6; face++) {
    const col = face % 3;
    const row = Math.floor(face / 3);
    // the box round what is not see-through, in this die's cell of the sheet
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = Math.floor(row * cellH); y < Math.floor((row + 1) * cellH); y++) {
      for (let x = Math.floor(col * cellW); x < Math.floor((col + 1) * cellW); x++) {
        if (sheet.pixels[(y * sheet.width + x) * 4 + 3] > 40) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const crop = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) sheet.pixels.copy(crop, y * w * 4, ((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + w) * 4);
    const small = downscale({ width: w, height: h, pixels: crop }, DIE_PX / w); // every die the same width
    const left = col * DIE_CELL + Math.floor((DIE_CELL - small.width) / 2);
    const top = row * DIE_CELL + Math.floor((DIE_CELL - small.height) / 2);
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const from = (y * small.width + x) * 4;
        const to = ((top + y) * DIE_CELL * 3 + left + x) * 4;
        for (let c = 0; c < 4; c++) out[to + c] = small.pixels[from + c];
      }
    }
  }
  write('dice.png', { width: DIE_CELL * 3, height: DIE_CELL * 2, pixels: out });
}

// --- the pieces ----------------------------------------------------------------------------------------------------------
const TOKENS = { red: 'Red-T.png', green: 'Green-T.png', yellow: 'Yellow-T.png', blue: 'Blue-T.png' };
const TOKEN_PX = 128; // the piece's width in the made picture

function buildToken(colour, file) {
  const src = read(file);
  // crop to what is not transparent (the pictures have a lot of empty margin)
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.pixels[(y * src.width + x) * 4 + 3] > 20) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const side = Math.max(w, h); // square, the piece centred, so it rotates and scales about its middle
  const square = Buffer.alloc(side * side * 4);
  const ox = Math.floor((side - w) / 2);
  const oy = Math.floor((side - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((y0 + y) * src.width + (x0 + x)) * 4;
      const to = ((oy + y) * side + (ox + x)) * 4;
      for (let c = 0; c < 4; c++) square[to + c] = src.pixels[from + c];
    }
  }
  write(`token-${colour}.png`, downscale({ width: side, height: side, pixels: square }, TOKEN_PX / side));
}

buildBoard();
buildStrips();
buildSetupPopups();
buildDice();
for (const [colour, file] of Object.entries(TOKENS)) buildToken(colour, file);
const bg = read('bg2.png');
write('bg-small.png', downscale(bg, 0.5));
