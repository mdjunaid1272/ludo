import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, downscale, encodePng } from './png.mjs';

// Turns img/spritefont/spritefont-sheet-1.png (one picture of the glyphs) into two bitmap fonts the game can load:
//   font-lg  half size, for big text (titles)
//   font-sm  quarter size, for everything else
// Each is a PNG plus an XML description (BMFont format: where every character is in the picture and how far to
// advance after it). Two sizes keep the graphics card from squeezing the 170 px glyphs down by 6x or more, which
// looks jagged. Run with `npm run build:font` after changing the sheet; the output is committed.
//
// The sheet has four rows: A-M, N-Z, 0-9 and the symbols ! ? . , : ; - _ + x / ( ) @ # $ %. Letters are upper case
// only; the game upper-cases text before drawing it.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'img', 'spritefont');
const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', '!?.,:;-_+x/()@#$%'];
const CORE = 128; // alpha above this is the glyph itself
const FAINT = 16; // alpha above this is still visible (the soft glow around it)
const PAD = 12; // most glow to keep around a glyph, in sheet pixels
const GAP = -0.07; // space added after each glyph, as a fraction of the line height (negative: the outlines overlap a little)
const SPACE = 0.34; // width of a space, as a fraction of the line height

const sheet = decodePng(fs.readFileSync(path.join(DIR, 'spritefont-sheet-1.png')));
const { width: W, height: H, pixels } = sheet;
const alpha = (x, y) => pixels[(y * W + x) * 4 + 3];

// --- find the rows -----------------------------------------------------------------------------
const rowFill = (y, t) => { let n = 0; for (let x = 0; x < W; x++) if (alpha(x, y) > t) n++; return n; };
// The boundary between two rows is the emptiest line between them.
const emptiest = (from, to) => { let best = from; for (let y = from; y <= to; y++) if (rowFill(y, CORE) < rowFill(best, CORE)) best = y; return best; };
const b1 = emptiest(194, 201);
const b2 = emptiest(378, 388);
const b3 = emptiest(540, 600);
const rowRanges = [[0, b1], [b1 + 1, b2], [b2 + 1, b3], [b3 + 1, H - 1]];

// --- find the glyphs in each row ---------------------------------------------------------------
function columnSegments(y0, y1) {
  const segments = [];
  let start = -1;
  for (let x = 0; x <= W; x++) {
    let on = false;
    if (x < W) for (let y = y0; y <= y1; y++) if (alpha(x, y) > CORE) { on = true; break; }
    if (on && start < 0) start = x;
    if (!on && start >= 0) { segments.push([start, x - 1]); start = -1; }
  }
  // Rows touch: a few pixels of the next row's glyphs can poke in. A real glyph is much taller than that.
  const heightOf = ([a, b]) => {
    let top = y1;
    let bottom = y0;
    for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) if (alpha(x, y) > CORE) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
    return bottom - top + 1;
  };
  const heights = segments.map(heightOf);
  const tallest = Math.max(...heights);
  return segments.filter((_, i) => heights[i] >= tallest * 0.3);
}

const glyphs = []; // { ch, row, x, y, w, h, core: [x0, x1] } in sheet pixels
ROWS.forEach((chars, row) => {
  const [y0, y1] = rowRanges[row];
  const segs = columnSegments(y0, y1);
  if (segs.length !== chars.length) throw new Error(`row ${row + 1}: expected ${chars.length} glyphs but found ${segs.length}`);
  segs.forEach(([a, b], i) => {
    const gapLeft = i > 0 ? a - segs[i - 1][1] - 1 : PAD * 2;
    const gapRight = i < segs.length - 1 ? segs[i + 1][0] - b - 1 : PAD * 2;
    const x0 = Math.max(0, a - Math.min(PAD, Math.floor(gapLeft / 2)));
    const x1 = Math.min(W - 1, b + Math.min(PAD, Math.floor(gapRight / 2)));
    let top = y1;
    let bottom = y0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (alpha(x, y) > FAINT) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
    glyphs.push({ ch: chars[i], row, x: x0, y: top, w: x1 - x0 + 1, h: bottom - top + 1, core: [a, b] });
  });
});

// --- common metrics ----------------------------------------------------------------------------
const band = ROWS.map((_, row) => {
  const g = glyphs.filter((q) => q.row === row);
  return { top: Math.min(...g.map((q) => q.y)), bottom: Math.max(...g.map((q) => q.y + q.h)) };
});
const LINE = Math.max(...band.map((b) => b.bottom - b.top)); // line height in sheet pixels
// Every row is aligned at its bottom edge, so letters, digits and symbols sit on one baseline.
const yOffsetOf = (g) => g.y - band[g.row].top + (LINE - (band[g.row].bottom - band[g.row].top));

// --- write the fonts ---------------------------------------------------------------------------
function writeFont(name, factor) {
  const image = factor === 1 ? sheet : downscale(sheet, factor);
  const scale = (n) => Math.round(n * factor);
  const line = scale(LINE);
  const chars = [];
  const add = (id, g, extra = {}) => chars.push({ id, x: g ? Math.floor(g.x * factor) : 0, y: g ? Math.floor(g.y * factor) : 0, w: g ? Math.ceil((g.x + g.w) * factor) - Math.floor(g.x * factor) : 0, h: g ? Math.ceil((g.y + g.h) * factor) - Math.floor(g.y * factor) : 0, xoff: g ? scale(g.core[0] - g.x) * -1 : 0, yoff: g ? scale(yOffsetOf(g)) : 0, adv: g ? scale(g.core[1] - g.core[0] + 1) + Math.round(line * GAP) : Math.round(line * SPACE), ...extra });
  for (const g of glyphs) {
    add(g.ch.charCodeAt(0), g);
    if (/[A-Z]/.test(g.ch)) { /* lower case is handled by the game (upper-cased before drawing) */ }
  }
  add(32, null); // space
  // Quotes and apostrophes: the comma, raised to the top of the line.
  const comma = glyphs.find((g) => g.ch === ',');
  for (const id of [39, 34, 96, 0x2019, 0x2018]) add(id, comma, { yoff: Math.round(line * 0.03) });
  // A middle dot or bullet: the full stop, lifted to mid-height.
  const dot = glyphs.find((g) => g.ch === '.');
  for (const id of [0xb7, 0x2022]) add(id, dot, { yoff: Math.round(line * 0.4) });
  // Ellipsis character: three full stops would need kerning tricks, so it becomes a single one.
  chars.sort((a, b) => a.id - b.id);

  const xml = [
    '<?xml version="1.0"?>',
    '<font>',
    `  <info face="spritefont-${name}" size="${line}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="1" aa="1" padding="0,0,0,0" spacing="0,0"/>`,
    `  <common lineHeight="${line}" base="${line}" scaleW="${image.width}" scaleH="${image.height}" pages="1" packed="0"/>`,
    '  <pages>',
    `    <page id="0" file="font-${name}.png"/>`,
    '  </pages>',
    `  <chars count="${chars.length}">`,
    ...chars.map((c) => `    <char id="${c.id}" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" xoffset="${c.xoff}" yoffset="${c.yoff}" xadvance="${c.adv}" page="0" chnl="15"/>`),
    '  </chars>',
    '</font>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DIR, `font-${name}.xml`), xml);
  fs.writeFileSync(path.join(DIR, `font-${name}.png`), encodePng(image));
  return { name, line, image: `${image.width}x${image.height}`, glyphs: chars.length };
}

for (const info of [writeFont('lg', 0.5), writeFont('sm', 0.25)]) console.log(`font-${info.name}: line height ${info.line}px, picture ${info.image}, ${info.glyphs} characters`);
console.log(`rows split at y = ${b1}, ${b2}, ${b3}; sheet line height ${LINE}px`);
