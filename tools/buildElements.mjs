import fs from 'node:fs';
import { decodePng, downscale, encodePng } from './png.mjs';

// Prepares the pictures in img/elements for the game (npm run build:elements). The originals stay as they are; the game loads
// the files made here:
//   board.png        the board, warped so that every cell is exactly the same size and the 15 x 15 cells fill the picture
//                    (the artwork's cells vary a little in size and it has a frame, which the game's square grid cannot follow)
//   token-<colour>.png   the four pieces, cropped to the piece and made small (they are drawn about 40 px wide)
//   bg.png           the wooden background at half size
const DIR = new URL('../img/elements/', import.meta.url);
const read = (name) => decodePng(fs.readFileSync(new URL(name, DIR)));
const write = (name, image) => {
  fs.writeFileSync(new URL(name, DIR), encodePng(image));
  console.log(`${name}: ${image.width} x ${image.height}, ${Math.round(fs.statSync(new URL(name, DIR)).size / 1024)} KB`);
};

// --- the board -----------------------------------------------------------------------------------------------------------
// Where the 16 grid lines of ludo-board.png are, in its pixels (measured from the picture, see docs/ASSETS.md).
const XS = [42, 127, 204, 281, 361, 437, 516, 592, 669, 744, 821, 899, 977, 1057, 1134, 1214];
const YS = [45, 126, 200, 275, 347, 415, 480, 559, 633, 712, 784, 858, 931, 1004, 1081, 1157];
const CELL_PX = 64; // pixels per cell in the made picture

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
  const src = read('ludo-board.png');
  const size = CELL_PX * 15;
  const pixels = Buffer.alloc(size * size * 4);
  // Each output cell is filled from the matching cell of the artwork (stretched a little to fit).
  const mapAxis = (v, L) => {
    const cell = Math.min(14, Math.floor(v / CELL_PX));
    const t = (v - cell * CELL_PX + 0.5) / CELL_PX;
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
  write('board.png', { width: size, height: size, pixels });
}

// --- the pieces ----------------------------------------------------------------------------------------------------------
const TOKENS = { red: 'Red-Token.png', green: 'GreenToken.png', yellow: 'Yellow-Token.png', blue: 'blue-token.png' };
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
for (const [colour, file] of Object.entries(TOKENS)) buildToken(colour, file);
const bg = read('bg.png');
write('bg-small.png', downscale(bg, 0.5));
