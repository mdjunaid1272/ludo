import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LOBBY_ACTION_LABELS, SETUP_PROMPTS, estimateTextWidth } from '../src/config/layout.js';
import { SETTING_ROWS } from '../src/config/settingsRows.js';
import { BIG_TEXT_FROM, TEXT_SCALE } from '../src/config/textMetrics.js';
import { SETUP_TITLES } from '../src/ui/SetupDialog.js';

// The picture font (img/spritefont, made by tools/buildSpriteFont.mjs) is checked as data: the character table must
// be sound, every character the game's own labels use must exist in it, and the layout code's width estimate must not
// be smaller than the real width (that is what keeps text from running out of its box).

const DIR = new URL('../img/spritefont/', import.meta.url);

function loadFont(name) {
  const xml = fs.readFileSync(new URL(`font-${name}.xml`, DIR), 'utf8');
  const png = fs.readFileSync(new URL(`font-${name}.png`, DIR));
  const chars = new Map();
  for (const m of xml.matchAll(/<char ([^>]*)\/>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="(-?\d+)"/g)].map(([, k, v]) => [k, Number(v)]));
    chars.set(attrs.id, attrs);
  }
  return {
    chars,
    line: Number(/lineHeight="(\d+)"/.exec(xml)[1]),
    size: Number(/<info [^>]*size="(\d+)"/.exec(xml)[1]),
    imageW: png.readUInt32BE(16),
    imageH: png.readUInt32BE(20),
  };
}

const fonts = { sm: loadFont('sm'), lg: loadFont('lg') };
const widthOf = (font, text, size) => ([...text.toUpperCase()].reduce((sum, ch) => sum + (font.chars.get(ch.charCodeAt(0))?.xadvance ?? 0), 0) * size) / font.size;

// Everything the game writes in a fixed place; messages built from variables are covered by the same characters.
const LABELS = [
  'Player vs Computer', 'Local Multiplayer', 'Play Online', 'With Friends', 'Settings', 'LUDO', 'Restart', 'Menu', 'Back', 'Cancel', 'Leave', 'Play again',
  'The classic race home', 'Online Multiplayer', 'Choose how to play', 'Looking for players...', 'Match found!',
  'Room code (tap to copy)', 'Share this code with friends', 'Waiting for the host...', 'Enter the room code', 'How many friends?', '1 friend', '2 friends', '3 friends',
  'Create a room or join one', 'Create a room', 'Join with a code', 'Rejoin room BCDF', 'Empty (tap to sit)', 'Computer (remove)', 'Player found', 'Searching...',
  'YELLOW (CPU) rolled 6: 3rd 6, turn lost', 'BLUE captured GREEN!', 'RED WINS!', '0/4', '4 players - classic rules - computer: normal',
  'Time ran out, so the computer played your turn.', 'Reconnected', "You joined from another window.", 'Choose 3 colours (2/3)', '3 players: pick your colour', 'Pick your colour',
  ...Object.values(SETUP_TITLES), ...SETUP_PROMPTS, ...LOBBY_ACTION_LABELS,
  ...SETTING_ROWS.flatMap((row) => [row.label, row.desc, ...row.options.map((o) => row.format(o))]),
];

describe.each(Object.entries(fonts))('font-%s', (name, font) => {
  it('has a sound character table', () => {
    expect(font.chars.size).toBeGreaterThan(55);
    for (const c of font.chars.values()) {
      expect(c.x >= 0 && c.y >= 0 && c.x + c.width <= font.imageW && c.y + c.height <= font.imageH, `char ${c.id} lies inside the picture`).toBe(true);
      expect(c.yoffset >= 0 && c.yoffset + c.height <= font.line + 2, `char ${c.id} sits inside the line`).toBe(true);
      expect(c.xadvance).toBeGreaterThan(0);
    }
  });

  it('has every letter, digit and symbol of the sheet, and a space and apostrophe', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,:;-_+x/()@#$% \'') expect(font.chars.has(ch.toUpperCase().charCodeAt(0) === 88 && ch === 'x' ? 120 : ch.charCodeAt(0)), `"${ch}"`).toBe(true);
  });

  it('has every character the game labels use (upper-cased)', () => {
    const missing = new Set();
    for (const text of LABELS) for (const ch of text.toUpperCase()) if (!font.chars.has(ch.charCodeAt(0))) missing.add(ch);
    expect([...missing]).toEqual([]);
  });
});

describe('width estimate', () => {
  it('is never smaller than the real width of the game labels, at any size', () => {
    for (const text of LABELS) {
      for (const requested of [12, 18, 24, 40, 80]) {
        const size = requested * TEXT_SCALE;
        const font = size >= BIG_TEXT_FROM ? fonts.lg : fonts.sm;
        // The estimate is an average per character, so a very short word of wide letters ("Menu") can run a little over:
        // allow 0.15 of a character.
        expect(estimateTextWidth(text.length, requested) + 0.15 * size, `"${text}" at ${requested}`).toBeGreaterThanOrEqual(widthOf(font, text, size) * 0.995);
      }
    }
  });
});
