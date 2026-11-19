import fs from 'node:fs';
import { BOARD_MARGIN_CELLS } from '../src/config/boardPicture.js';
import { HOME_LANE_CELLS, START_INDEX, TRACK_CELLS, YARD_CORNER, YARD_SLOTS } from '../src/game/path.js';
import { decodePng, downscale, encodePng } from './png.mjs';
import { makeWaterBase, makeWaterLight } from './waterTile.mjs';

// Prepares the pictures in img/elements for the game (npm run build:elements). The originals stay as they are; the game loads
// the files made here:
//   board.png        the board (from ludo-board3.png; its blue water is cut out, see-through, so moving water shows behind it), turned a quarter so the colours sit in the game's corners, and warped so that every
//                    cell is exactly the same size and the 15 x 15 cells fill the picture (the artwork's cells vary a little in size and
//                    the grid is not centred in it, which the game's square grid cannot follow). A small margin of the artwork round the
//                    grid is kept (BOARD_MARGIN_CELLS), so the yards' rims are not cut off.
//   water-base.png, water-light.png   the two seamless water pictures that move behind the board (tools/waterTile.mjs)
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
// Only the board is used (the game draws its own moving water round it).
const BOARD3_TOP = 468;
const BOARD3_ROWS = 1283;
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
  cutOutWater(pixels, size);
  write('board.png', { width: size, height: size, pixels });
}

// Makes the water see-through: the more blue a pixel is (blue well above red and green), the more transparent it gets, with a soft
// edge. Only the water counts: blue pixels that can be reached from the picture's border through blue pixels. The blue player's
// yard panel and home column are as blue as the water, but the gold frame and the stone cells shut them in, so they stay as they are.
function cutOutWater(pixels, size) {
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const blueness = (p) => pixels[p * 4 + 2] - Math.max(pixels[p * 4], pixels[p * 4 + 1]);
  const water = new Uint8Array(size * size);
  const stack = [];
  const push = (p) => {
    if (!water[p] && blueness(p) >= 25) {
      water[p] = 1;
      stack.push(p);
    }
  };
  for (let i = 0; i < size; i++) {
    push(i); push((size - 1) * size + i); push(i * size); push(i * size + size - 1);
  }
  const spread = () => {
    while (stack.length) {
      const p = stack.pop();
      const x = p % size;
      if (x > 0) push(p - 1);
      if (x < size - 1) push(p + 1);
      if (p >= size) push(p - size);
      if (p < size * (size - 1)) push(p + size);
    }
  };
  spread();
  // Pockets of water the border cannot reach (a seam of leaves or stone cuts them off): any other big blue area is water too, except
  // the ones the blue player's yard panel, home column and the centre triangle are in.
  const margin = Math.round(BOARD_MARGIN_CELLS * CELL_PX);
  const at = (cx, cy) => margin + Math.round(cx * CELL_PX) + (margin + Math.round(cy * CELL_PX)) * size;
  const keepSeeds = [
    ...YARD_SLOTS.blue.map(([dx, dy]) => at(YARD_CORNER.blue[0] + dx, YARD_CORNER.blue[1] + dy)),
    ...[...HOME_LANE_CELLS.blue, TRACK_CELLS[START_INDEX.blue]].flatMap(([c, r]) => [0.15, 0.85].flatMap((u) => [0.15, 0.85].map((v) => at(c + u, r + v)))),
    at(7.5, 8.4),
  ];
  const label = new Int32Array(size * size);
  let next = 0;
  const keep = new Set();
  for (let start = 0; start < size * size; start++) {
    if (water[start] || label[start] || blueness(start) < 25) continue;
    next++;
    const members = [start];
    label[start] = next;
    for (let k = 0; k < members.length; k++) {
      const p = members[k];
      const x = p % size;
      for (const q of [x > 0 ? p - 1 : -1, x < size - 1 ? p + 1 : -1, p - size, p + size]) {
        if (q < 0 || q >= size * size || water[q] || label[q] || blueness(q) < 25) continue;
        label[q] = next;
        members.push(q);
      }
    }
    if (members.length < 1500) continue;
    if (keepSeeds.some((s) => label[s] === next)) keep.add(next);
    else for (const p of members) { water[p] = 1; stack.push(p); }
  }
  stack.length = 0;
  // soft edge: the transparency follows how blue the pixel is, but only for the pixels the water reaches (and the ones just beside them)
  const near = new Uint8Array(size * size);
  for (let p = 0; p < size * size; p++) {
    if (!water[p]) continue;
    const x = p % size;
    const y = (p - x) / size;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) near[ny * size + nx] = 1;
    }
  }
  for (let p = 0; p < size * size; p++) {
    if (!water[p] && !near[p]) continue;
    pixels[p * 4 + 3] = Math.round(255 * (1 - smooth(25, 55, blueness(p))));
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
write('water-base.png', makeWaterBase());
write('water-light.png', makeWaterLight());
buildDice();
for (const [colour, file] of Object.entries(TOKENS)) buildToken(colour, file);
const bg = read('bg2.png');
write('bg-small.png', downscale(bg, 0.5));
