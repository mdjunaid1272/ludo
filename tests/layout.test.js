import { describe, it, expect } from 'vitest';
import {
  computeLayout, BOARD, MIN_TOUCH, MIN_TEXT, estimateTextWidth, applyViewport, layout, SETUP_TITLE, SETUP_PROMPTS,
  ONLINE_STACK_LABEL_CHARS, LOBBY_ACTION_LABELS, ONLINE_INFO_CHARS, avatarOuterSize, AVATAR_GAP_PX, PILL_MIN_H, PILL_MIN_W, gameAreaFor, WEB_MAX_HEIGHT, WEB_MAX_WIDTH, STATUS_CHARS, PROFILE_NAME_CHARS, finishLayout, resultsLayout, FINISH_NOTE_CHARS,
} from '../src/config/layout.js';
import { SETTING_ROWS } from '../src/config/settingsRows.js';

// Real devices, CSS pixels: [name, width, height].
const VIEWPORTS = [
  ['320x480 small phone', 320, 480],
  ['iPhone SE portrait', 375, 667],
  ['Pixel/Android portrait', 360, 640],
  ['iPhone 14 portrait', 390, 844],
  ['Pixel 7 portrait', 412, 915],
  ['phone landscape 667x375', 667, 375],
  ['iPhone 14 landscape', 844, 390],
  ['Pixel 7 landscape', 915, 412],
  ['tiny landscape 568x320', 568, 320],
  ['iPad portrait', 768, 1024],
  ['iPad landscape', 1024, 768],
  ['iPad Pro portrait', 820, 1180],
  ['laptop 1366x768', 1366, 768],
  ['desktop 1920x1080', 1920, 1080],
  ['2560x1440', 2560, 1440],
  ['ultrawide 3440x1440', 3440, 1440],
  ['square 800x800', 800, 800],
  ['narrow desktop window 600x900', 600, 900],
  // The 9:16 box a desktop browser window gets (see gameAreaFor).
  ...[[1920, 1080], [1366, 768], [2560, 1440], [1280, 600], [3440, 1440], [1920, 1200], [1366, 600], [1000, 480]].map(([w, h]) => {
    const a = gameAreaFor(w, h, false);
    return [`web box in a ${w}x${h} window`, a.w, a.h];
  }),
];

const rectOf = ({ x, y, w, h }) => ({ x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 });
const topLeft = ({ x, y, w, h }) => ({ x1: x, y1: y, x2: x + w, y2: y + h });
const overlap = (a, b) => a.x1 < b.x2 - 0.5 && b.x1 < a.x2 - 0.5 && a.y1 < b.y2 - 0.5 && b.y1 < a.y2 - 0.5;
const inside = (r, w, h) => r.x1 >= -0.5 && r.y1 >= -0.5 && r.x2 <= w + 0.5 && r.y2 <= h + 0.5;

// Every HUD element as a rectangle in logical px, with the die at one of its four spots (next to a yard at the left or right,
// above or below the board).
function hudRects(l, right = false, below = false) {
  const h = l.hud;
  const lines = h.status.lines;
  const statusH = h.status.font * 1.25 * lines;
  return {
    title: rectOf({ x: h.title.x, y: h.title.y, w: h.title.font * 4 * 0.85, h: h.title.font * 1.2 }),
    restart: rectOf(h.restart),
    menu: rectOf(h.menu),
    status: rectOf({ x: h.status.x, y: h.status.y, w: h.status.w, h: statusH }),
    dice: rectOf({ ...h.diceSpot(right, below), w: h.dice.size, h: h.dice.size }),
    // The four avatars (when the screen has room for them), as big as they get: the current player's is enlarged and has a ring.
    ...Object.fromEntries(h.avatar ? [[false, false], [true, false], [false, true], [true, true]].map(([r, b], i) => [`avatar${i}`, rectOf({ ...h.avatar.slot(r, b), w: avatarOuterSize(h.avatar.size), h: avatarOuterSize(h.avatar.size) })]) : []),
    // Their names (a full 16 characters), where the screen has room for them.
    ...Object.fromEntries(h.avatar ? [[false, false], [true, false], [false, true], [true, true]].flatMap(([r, b], i) => {
      const at = h.avatar.nameSlot(r, b);
      if (!at) return [];
      const w = estimateTextWidth(PROFILE_NAME_CHARS, h.avatar.nameFont);
      const x1 = at.originX === 1 ? at.x - w : at.x;
      return [[`name${i}`, { x1, y1: at.y - h.avatar.nameFont * 0.65, x2: x1 + w, y2: at.y + h.avatar.nameFont * 0.65 }]];
    }) : []),
  };
}

describe.each(VIEWPORTS)('layout for %s', (_name, vw, vh) => {
  const l = computeLayout(vw, vh);
  const real = (logical) => logical * l.scale;
  // On a very small screen (320 px wide phones and the like) the picture font cannot be as large as the minimums below and
  // still fit its space; it is chunky, so a little smaller is still readable.
  const slack = l.scale < 0.5 ? 2.5 : 0;

  it('uses the expected orientation and a logical canvas that fits the viewport', () => {
    expect(l.orientation).toBe(vw / vh >= 1.15 ? 'landscape' : 'portrait');
    expect(l.width * l.scale).toBeLessThanOrEqual(vw + 0.5);
    expect(l.height * l.scale).toBeLessThanOrEqual(vh + 0.5);
  });

  it('keeps the whole board on screen and as large as the screen allows', () => {
    expect(l.boardX).toBeGreaterThanOrEqual(0);
    expect(l.boardY).toBeGreaterThanOrEqual(0);
    expect(l.boardX + BOARD).toBeLessThanOrEqual(l.width);
    expect(l.boardY + BOARD).toBeLessThanOrEqual(l.height);
    const boardReal = real(BOARD);
    // Portrait: as wide as the screen unless the screen is too short for the header as well.
    if (l.orientation === 'portrait') expect(boardReal).toBeGreaterThanOrEqual(vh / vw >= 1.7 ? vw * 0.97 : vw * 0.6);
    else expect(boardReal).toBeGreaterThanOrEqual(Math.min(vh, vw * 0.6) * 0.97);
  });

  it('has HUD elements that stay inside the canvas, do not overlap, and avoid the board, for the die at each of its four spots', () => {
    const board = { x1: l.boardX, y1: l.boardY, x2: l.boardX + BOARD, y2: l.boardY + BOARD };
    for (const [right, below] of [[false, false], [true, false], [false, true], [true, true]]) {
      const where = `die right=${right} below=${below}`;
      const rects = hudRects(l, right, below);
      const names = Object.keys(rects);
      for (const name of names) {
        expect(inside(rects[name], l.width, l.height), `${name} outside canvas (${where})`).toBe(true);
        expect(overlap(rects[name], board), `${name} overlaps the board (${where})`).toBe(false);
      }
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          expect(overlap(rects[names[i]], rects[names[j]]), `${names[i]} overlaps ${names[j]} (${where})`).toBe(false);
        }
      }
    }
  });

  it('has avatar slots at the same corners as the yards, at a readable size, unless the screen is too short', () => {
    const a = l.hud.avatar;
    if (!a) {
      expect(l.orientation, 'only the stacked portrait arrangement has no avatars').toBe('portrait');
      expect(l.hud.diceSpot(false, true).y, 'it has no row below the board').toBe(l.hud.diceSpot(false, false).y);
      return;
    }
    expect(a.slot(false, false).x).toBeLessThan(a.slot(true, false).x);
    expect(a.slot(false, false).y).toBeLessThan(a.slot(false, true).y);
    expect(a.slot(false, false).y, 'same row as the die').toBe(l.hud.diceSpot(false, false).y);
    expect(a.slot(true, true).y, 'same row as the die').toBe(l.hud.diceSpot(true, true).y);
    expect(real(a.size), 'avatar size on screen').toBeGreaterThanOrEqual(36);
    // The die is exactly AVATAR_GAP_PX (10 real pixels) from the avatar beside it, for every colour's spot: the avatar is the
    // current player's, so it is the larger one with its ring.
    for (const [right, below] of [[false, false], [true, false], [false, true], [true, true]]) {
      const die = l.hud.diceSpot(right, below);
      const av = a.slot(right, below);
      const gap = Math.abs(die.x - av.x) - l.hud.dice.size / 2 - avatarOuterSize(a.size) / 2;
      expect(gap * l.scale, `gap in real pixels between the die and the avatar (right=${right} below=${below})`).toBeCloseTo(AVATAR_GAP_PX, 1);
    }
  });

  it('has room for the names beside the avatars on most screens, and never lets them cross another element (checked above)', () => {
    const a = l.hud.avatar;
    if (!a) return;
    const slots = [[false, false], [true, false], [false, true], [true, true]].map(([r, b]) => a.nameSlot(r, b));
    if (slots.some(Boolean)) expect(a.nameFont * l.scale, 'name text size on screen').toBeGreaterThanOrEqual(8 - slack);
    // Phones (portrait and landscape) have room for all four names.
    if (vw <= 915 && vw >= 360 && vh >= 640 && vh >= vw) expect(slots.every(Boolean), 'names beside all four avatars').toBe(true);
  });

  it('has a profile popup that fits the screen, with touch-sized buttons and a text field', () => {
    const p = l.profile;
    expect(p.top).toBeGreaterThanOrEqual(-0.5);
    expect(p.top + p.h).toBeLessThanOrEqual(l.height + 0.5);
    expect(p.cx - p.w / 2).toBeGreaterThanOrEqual(-0.5);
    expect(p.cx + p.w / 2).toBeLessThanOrEqual(l.width + 0.5);
    expect(real(p.fieldH), 'text field height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(p.footH), 'Save / Cancel height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    // top to bottom, nothing crosses anything else
    const rows = [
      [p.titleY - p.titleFont * 0.6, p.titleY + p.titleFont * 0.6],
      ...(p.avatar > 0 ? [[p.avatarY - p.avatar / 2, p.avatarY + p.avatar / 2]] : []),
      [p.nameY - p.nameFont * 0.65, p.nameY + p.nameFont * 0.65],
      [p.fieldY - p.fieldH / 2, p.fieldY + p.fieldH / 2],
      [p.noteY - p.noteFont * 0.65, p.noteY + p.noteFont * 0.65],
      [p.footY - p.footH / 2, p.footY + p.footH / 2],
    ];
    for (let i = 1; i < rows.length; i++) expect(rows[i][0], `row ${i} starts below row ${i - 1}`).toBeGreaterThanOrEqual(rows[i - 1][1] - 0.5);
    expect(rows[0][0]).toBeGreaterThanOrEqual(p.top - 0.5);
    expect(rows.at(-1)[1]).toBeLessThanOrEqual(p.top + p.h + 0.5);
    // a 16 character name and the 16/16 counter fit the width they have
    expect(estimateTextWidth(PROFILE_NAME_CHARS, p.nameFont)).toBeLessThanOrEqual(p.inner + 0.5);
    expect(real(p.nameFont), 'current name size on screen').toBeGreaterThanOrEqual(12 - slack);
    expect(real(p.fieldFont), 'typed text size on screen').toBeGreaterThanOrEqual(12);
  });

  it('has a "finished" popup that fits the screen, top to bottom, with a touch-sized Continue button', () => {
    const p = finishLayout(l);
    expect(p.top).toBeGreaterThanOrEqual(-0.5);
    expect(p.top + p.h).toBeLessThanOrEqual(l.height + 0.5);
    expect(p.cx - p.w / 2).toBeGreaterThanOrEqual(-0.5);
    expect(p.cx + p.w / 2).toBeLessThanOrEqual(l.width + 0.5);
    expect(real(p.btnH), 'Continue height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    const rows = [
      [p.posY - p.posFont * 0.55, p.posY + p.posFont * 0.55],
      ...(p.avatar > 0 ? [[p.avatarY - p.avatar / 2, p.avatarY + p.avatar / 2]] : []),
      [p.nameY - p.nameFont * 0.65, p.nameY + p.nameFont * 0.65],
      [p.noteY - p.noteFont * 0.65, p.noteY + p.noteFont * 0.65],
      [p.btnY - p.btnH / 2, p.btnY + p.btnH / 2],
    ];
    for (let i = 1; i < rows.length; i++) expect(rows[i][0], `row ${i} starts below row ${i - 1}`).toBeGreaterThanOrEqual(rows[i - 1][1] - 0.5);
    expect(rows[0][0]).toBeGreaterThanOrEqual(p.top - 0.5);
    expect(rows.at(-1)[1]).toBeLessThanOrEqual(p.top + p.h + 0.5);
    expect(estimateTextWidth(PROFILE_NAME_CHARS, p.nameFont)).toBeLessThanOrEqual(p.inner + 0.5);
    expect(estimateTextWidth(FINISH_NOTE_CHARS, p.noteFont)).toBeLessThanOrEqual(p.inner + 0.5);
    expect(real(p.noteFont), 'note size on screen').toBeGreaterThanOrEqual(10 - slack);
    expect(real(p.nameFont), 'name size on screen').toBeGreaterThanOrEqual(12 - slack);
  });

  it.each([2, 3, 4])('has a final results screen for %i players that fits, in order, with touch-sized buttons', (count) => {
    const r = resultsLayout(l, count);
    expect(r.top).toBeGreaterThanOrEqual(-0.5);
    expect(r.top + r.h).toBeLessThanOrEqual(l.height + 0.5);
    expect(r.cx + r.w / 2).toBeLessThanOrEqual(l.width + 0.5);
    expect(real(r.footH), 'button height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(r.rowH).toBeGreaterThanOrEqual(32);
    expect(r.titleY - r.titleFont * 0.6).toBeGreaterThanOrEqual(r.top - 0.5);
    let previous = r.titleY + r.titleFont * 0.6;
    for (let i = 0; i < count; i++) {
      expect(r.rowY(i) - r.rowH / 2, `row ${i} below the previous one`).toBeGreaterThanOrEqual(previous - 0.5);
      previous = r.rowY(i) + r.rowH / 2;
    }
    expect(r.footY - r.footH / 2, 'buttons below the rows').toBeGreaterThanOrEqual(previous - 0.5);
    expect(r.footY + r.footH / 2, 'buttons inside the panel').toBeLessThanOrEqual(r.top + r.h + 0.5);
    // a long name (16 characters, plus ' (YOU)') fits beside the avatar
    expect(r.nameX + estimateTextWidth(PROFILE_NAME_CHARS + 6, r.nameFont)).toBeLessThanOrEqual(r.cx + r.inner / 2 + 0.5);
    expect(real(r.nameFont), 'name size on screen').toBeGreaterThanOrEqual(9 - slack);
  });

  it('has a profile chip in the top left of the splash page that does not touch the settings button or the title', () => {
    const m = l.menu;
    const c = m.profile;
    const chip = rectOf(c);
    expect(inside(chip, l.width, l.height)).toBe(true);
    expect(overlap(chip, rectOf({ x: m.settingsX, y: m.settingsY, w: m.settingsW, h: m.settingsH })), 'overlaps the settings button').toBe(false);
    expect(overlap(chip, rectOf({ x: l.width / 2, y: m.titleY, w: m.titleFont * 4 * 0.85, h: m.titleFont * 1.2 })), 'overlaps the title').toBe(false);
    expect(real(c.h), 'tap height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(estimateTextWidth(PROFILE_NAME_CHARS, c.font), 'a 16 character name fits the chip').toBeLessThanOrEqual(c.w - c.avatar - c.pad * 3 + 0.5);
    expect(real(c.font), 'name size on screen').toBeGreaterThanOrEqual(10 - slack);
  });

  it('puts the die beside the yard it belongs to: left or right of the layout, above or below the board', () => {
    const h = l.hud;
    expect(h.diceSpot(false, false).x).toBeLessThan(h.diceSpot(true, false).x);
    expect(h.diceSpot(false, true).x).toBeLessThan(h.diceSpot(true, true).x);
    expect(h.diceSpot(false, false).x).toBe(h.diceSpot(false, true).x);
    expect(h.diceSpot(false, false).y).toBeLessThanOrEqual(h.diceSpot(false, true).y);
    if (l.orientation === 'portrait') {
      expect(h.diceSpot(false, false).y, 'above the board').toBeLessThan(l.boardY);
      // On a screen too short to leave room below the board, both spots are the row above it.
      if (h.diceSpot(false, true).y !== h.diceSpot(false, false).y) expect(h.diceSpot(false, true).y, 'below the board').toBeGreaterThan(l.boardY + BOARD);
    }
  });

  it('gives buttons and the die a comfortable rendered size', () => {
    const h = l.hud;
    for (const b of [h.restart, h.menu]) {
      expect(real(b.h), 'pill height').toBeGreaterThanOrEqual(PILL_MIN_H - 0.5);
      expect(real(b.w), 'pill width').toBeGreaterThanOrEqual(PILL_MIN_W - 0.5);
      expect(b.h, 'the pills are compact: 36 logical px, or the minimum when the screen is scaled down').toBeLessThanOrEqual(Math.max(36, PILL_MIN_H / l.scale) + 0.01);
    }
    expect(real(h.dice.size)).toBeGreaterThanOrEqual(42 - 0.5); // the die is small; Dice gives it a MIN_TOUCH tap area
    expect(real(h.status.font)).toBeGreaterThanOrEqual(11 - slack); // (the countdown arc widens the avatars, so the status line is a little narrower) the status line has the width between the two top die spots, in up to three lines
  });

  it('fits the longest status message in the lines it has, beside the die', () => {
    const { status } = l.hud;
    const longest = 'YELLOW (CPU) rolled 6: 3rd 6, turn lost';
    expect(longest.length).toBeLessThanOrEqual(STATUS_CHARS);
    expect(estimateTextWidth(longest.length, status.font) / status.w).toBeLessThanOrEqual(status.lines);
  });

  it('lays out the menu without overlap and with touch-sized buttons', () => {
    const m = l.menu;
    expect(m.buttonXs).toHaveLength(4);
    expect(m.buttonYs).toHaveLength(4);
    const ys = m.buttonYs.map((y, i) => rectOf({ x: m.buttonXs[i], y, w: m.buttonW, h: m.buttonH }));
    const parts = [
      ...ys,
      rectOf({ x: m.settingsX, y: m.settingsY, w: m.settingsW, h: m.settingsH }), // top right corner
      rectOf({ x: l.width / 2, y: m.subtitleY, w: 300, h: m.subtitleFont * 1.3 }),
      rectOf({ x: l.width / 2, y: m.titleY, w: estimateTextWidth('LUDO'.length, m.titleFont), h: m.titleFont }),
    ];
    parts.forEach((r, i) => {
      expect(inside(r, l.width, l.height), `menu part ${i}`).toBe(true);
      for (let j = i + 1; j < parts.length; j++) expect(overlap(r, parts[j]), `menu ${i} vs ${j}`).toBe(false);
    });
    expect(real(m.buttonH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(m.settingsH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(m.settingsW), 'settings picture width').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(m.settingsX, 'settings is in the right half').toBeGreaterThan(l.width / 2);
    expect(m.settingsY, 'settings is in the top part').toBeLessThan(l.height / 4);
  });

  it('fits the Player vs Computer popup on screen, with touch-sized, non-overlapping controls', () => {
    const s = l.setup;
    const box = { x1: s.cx - s.w / 2, y1: s.top, x2: s.cx + s.w / 2, y2: s.top + s.h };
    expect(inside(box, l.width, l.height), 'popup inside the canvas').toBe(true);

    const countRow = s.countW * 3 + s.countGap * 2;
    const colorRow = s.colorW * 4 + s.colorGap * 3;
    const stack = {
      title: rectOf({ x: s.cx, y: s.titleY, w: estimateTextWidth(SETUP_TITLE.length, s.titleFont), h: s.titleFont * 1.2 }),
      prompt: rectOf({ x: s.cx, y: s.promptY, w: estimateTextWidth(Math.max(...SETUP_PROMPTS.map((p) => p.length)), s.promptFont), h: s.promptFont * 1.3 }),
      counts: rectOf({ x: s.cx, y: s.rowY, w: countRow, h: s.btnH }),
      colours: rectOf({ x: s.cx, y: s.rowY, w: colorRow, h: s.btnH }),
      back: rectOf({ x: s.cx, y: s.backY, w: s.backW, h: s.backH }),
      // Local Multiplayer shows Back and Start side by side.
      pair: rectOf({ x: s.cx, y: s.backY, w: s.backW * 2 + s.footGap, h: s.backH }),
    };
    for (const [name, r] of Object.entries(stack)) {
      expect(inside(r, l.width, l.height), `${name} inside the canvas`).toBe(true);
      expect(r.x1 >= box.x1 - 0.5 && r.x2 <= box.x2 + 0.5 && r.y1 >= box.y1 - 0.5 && r.y2 <= box.y2 + 0.5, `${name} inside the popup`).toBe(true);
    }
    // The two choice rows are shown one at a time, so only the stack order matters.
    for (const [a, b] of [['title', 'prompt'], ['prompt', 'counts'], ['prompt', 'colours'], ['counts', 'back'], ['colours', 'back'], ['colours', 'pair']]) {
      expect(overlap(stack[a], stack[b]), `${a} overlaps ${b}`).toBe(false);
    }
    expect(real(s.btnH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(s.backH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(s.titleFont)).toBeGreaterThanOrEqual(14); // the picture font is chunky: 14 px of it reads like 18 of a thin one
    expect(real(s.promptFont)).toBeGreaterThanOrEqual(12 - slack);
    expect(estimateTextWidth('YELLOW'.length, s.colorFont)).toBeLessThanOrEqual(s.colorW - 16 + 0.5);
    expect(real(s.colorFont)).toBeGreaterThanOrEqual(11 - slack);
  });

  it('lays out the online screens inside the canvas with touch-sized, non-overlapping controls', () => {
    const o = l.online;
    const overlapsAny = (rects, label) => {
      const entries = Object.entries(rects);
      for (const [name, r] of entries) expect(inside(r, l.width, l.height), `${label}: ${name} outside the canvas`).toBe(true);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) expect(overlap(entries[i][1], entries[j][1]), `${label}: ${entries[i][0]} overlaps ${entries[j][0]}`).toBe(false);
      }
    };
    const text = (x, y, chars, font) => rectOf({ x, y, w: estimateTextWidth(chars, font), h: font * 1.25 });
    const title = text(l.width / 2, o.titleY, 'Online Multiplayer'.length, o.titleFont);
    const info = text(l.width / 2, o.infoY, ONLINE_INFO_CHARS, o.infoFont);

    // Button stack (connect / home / create): up to four buttons.
    const stack = { title, info };
    o.stack.ys.forEach((y, i) => (stack[`button${i}`] = rectOf({ x: l.width / 2, y, w: o.stack.w, h: o.stack.h })));
    overlapsAny(stack, 'stack');
    expect(real(o.stack.h)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(estimateTextWidth(ONLINE_STACK_LABEL_CHARS, o.stack.font)).toBeLessThanOrEqual(o.stack.w - 30 + 0.5);

    // Keypad: 20 keys, four code boxes, and the Back / delete / Join row.
    const k = o.keypad;
    const pad = { title, info };
    for (let i = 0; i < 20; i++) pad[`key${i}`] = rectOf(k.keyRect(i));
    for (let i = 0; i < 4; i++) pad[`box${i}`] = rectOf(k.boxRect(i));
    for (let j = 0; j < 3; j++) pad[`bottom${j}`] = rectOf(k.bottomRect(j));
    overlapsAny(pad, 'keypad');
    expect(real(k.keyH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(k.keyW)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(k.bottomRect(0).h)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(estimateTextWidth(1, k.codeFont)).toBeLessThanOrEqual(k.boxW);
    expect(real(k.keyFont)).toBeGreaterThanOrEqual(11 - slack);

    // Lobby: code, four seats, and three action slots.
    const lb = o.lobby;
    const lobby = { title, info, label: text(lb.label.x, lb.label.y, 'Room code'.length, lb.label.font), code: rectOf({ x: lb.code.x, y: lb.code.y, w: estimateTextWidth(4, lb.code.font * 1.2), h: lb.code.font * 1.15 }) };
    lb.seats.forEach((r, i) => (lobby[`seat${i}`] = rectOf(r)));
    lb.actions.forEach((r, i) => (lobby[`action${i}`] = rectOf(r)));
    overlapsAny(lobby, 'lobby');
    for (const r of [...lb.seats, ...lb.actions]) expect(real(r.h)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    for (const label of LOBBY_ACTION_LABELS) {
      expect(estimateTextWidth(label.length, lb.actionFont), label).toBeLessThanOrEqual(lb.actions[0].w - 20 + 0.5);
    }
    // A seat row shows a colour name and its status ("Computer", "Empty - tap to move here"...).
    expect(estimateTextWidth('YELLOW  Empty (tap to sit)'.length, lb.seatFont)).toBeLessThanOrEqual(lb.seats[0].w - 50 + 0.5);
    expect(real(lb.seatFont)).toBeGreaterThanOrEqual(11 - slack);
  });

  it('fits the menu button names under their pictures, readable and touch-sized', () => {
    const m = l.menu;
    // Names wrap at labelWrap (a little wider than the picture, but not into the next button: cells are 24 px apart).
    expect(m.labelWrap).toBeLessThanOrEqual(m.buttonW + 24);
    const longest = m.labelLines === 1 ? 'Player vs Computer' : 'Computer'; // on two lines the longest word has to fit
    expect(estimateTextWidth(longest.length, m.labelFont)).toBeLessThanOrEqual(m.labelWrap);
    expect(real(m.labelFont)).toBeGreaterThanOrEqual(MIN_TEXT - 0.5);
    expect(real(m.buttonW), 'picture width').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(real(m.tileH), 'picture height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
  });

  it('lays out every settings row inside the canvas, between the title and the footer, without overlap', () => {
    const s = l.settings;
    const rows = SETTING_ROWS.map((_, i) => topLeft(s.rowRect(i)));
    const footer = rectOf({ x: l.width / 2, y: s.footerY, w: l.width - 60, h: s.footerH });
    const title = rectOf({ x: l.width / 2, y: s.titleY, w: 300, h: s.titleFont * 1.2 });
    rows.forEach((r, i) => {
      expect(inside(r, l.width, l.height), `row ${i}`).toBe(true);
      expect(overlap(r, footer), `row ${i} vs footer`).toBe(false);
      expect(overlap(r, title), `row ${i} vs title`).toBe(false);
      for (let j = i + 1; j < rows.length; j++) expect(overlap(r, rows[j]), `row ${i} vs ${j}`).toBe(false);
    });
    // Full touch size everywhere, except the "compact" fallback that only a very small screen may use.
    if (s.compact) {
      expect(l.scale, 'compact settings are only for tiny screens (a 320x480 phone is 0.44)').toBeLessThan(0.45);
      expect(real(s.btnH)).toBeGreaterThanOrEqual(34);
    } else {
      expect(real(s.btnH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    }
    expect(real(s.footerH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
    expect(s.rowH).toBeGreaterThanOrEqual(s.btnH);
  });

  it('keeps settings text clear of the control button, at a readable size', () => {
    const s = l.settings;
    for (const row of SETTING_ROWS) {
      expect(estimateTextWidth(row.label.length, s.labelFont), `label "${row.label}"`).toBeLessThanOrEqual(s.labelRoom + 0.5);
      if (s.showDesc) {
        expect(estimateTextWidth(row.desc.length, s.descFont), `desc "${row.desc}"`).toBeLessThanOrEqual(s.labelRoom + 0.5);
      }
    }
    expect(real(s.labelFont)).toBeGreaterThanOrEqual(MIN_TEXT - slack);
    if (s.showDesc) expect(real(s.descFont)).toBeGreaterThanOrEqual(MIN_TEXT - 0.5 - slack);
  });

  it('sizes the dialog to fit the canvas with touch-sized buttons', () => {
    const m = l.modal;
    expect(m.w).toBeLessThanOrEqual(l.width - 40 + 0.5);
    expect(m.h).toBeLessThanOrEqual(l.height);
    expect(real(m.btnH)).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
  });
});

describe('desktop web page', () => {
  const desktops = [[1920, 1080], [1366, 768], [2560, 1440], [1280, 600], [900, 1000]];

  it('gets a 9:16 box, as tall as the window allows and never bigger than 1080 x 1920', () => {
    for (const [w, h] of desktops) {
      const area = gameAreaFor(w, h, false);
      expect(area.h, `${w}x${h}`).toBe(Math.min(h, WEB_MAX_HEIGHT));
      expect(area.w).toBeLessThanOrEqual(Math.min(w, WEB_MAX_WIDTH));
    }
    for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 800]]) {
      const area = gameAreaFor(w, h, false);
      expect(area.w / area.h, `${w}x${h}`).toBeCloseTo(9 / 16, 2); // exactly 9:16 whenever the window allows
    }
    expect(gameAreaFor(1000, 480, false)).toEqual({ w: 320, h: 480, allowLandscape: false }); // never narrower than 320
    expect(gameAreaFor(1920, 1080, false)).toEqual({ w: 608, h: 1080, allowLandscape: false });
    expect(gameAreaFor(3840, 2160, false)).toEqual({ w: 1080, h: 1920, allowLandscape: false }); // capped at 1080 x 1920
    expect(gameAreaFor(400, 1000, false).w).toBe(400); // a window too narrow for 9:16 is simply its own width
  });

  it('always gets the portrait layout', () => {
    for (const [w, h] of desktops) {
      const area = gameAreaFor(w, h, false);
      const l = computeLayout(area.w, area.h, area.allowLandscape);
      expect(l.orientation, `${w}x${h}`).toBe('portrait');
      expect(l.width).toBe(BOARD);
    }
  });

  it('keeps controls usable even in a short, wide window', () => {
    const area = gameAreaFor(1280, 600, false);
    const l = computeLayout(area.w, area.h, area.allowLandscape);
    expect(l.hud.restart.h * l.scale).toBeGreaterThanOrEqual(PILL_MIN_H - 0.5);
  });

  it('leaves phones and tablets using the whole screen, landscape allowed', () => {
    expect(gameAreaFor(844, 390, true)).toEqual({ w: 844, h: 390, allowLandscape: true });
    const a = gameAreaFor(844, 390, true);
    expect(computeLayout(a.w, a.h, a.allowLandscape).orientation).toBe('landscape');
  });
});

describe('layout behaviour', () => {
  it('switches orientation at aspect ratio 1.15', () => {
    expect(computeLayout(1000, 900).orientation).toBe('portrait');
    expect(computeLayout(1100, 900).orientation).toBe('landscape');
  });

  it('is stable: nearby window sizes give the same logical canvas (so resizing does not restart the game)', () => {
    const a = computeLayout(1000, 560);
    const b = computeLayout(1008, 563);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    const c = computeLayout(390, 844);
    const d = computeLayout(392, 846);
    expect([c.width, c.height]).toEqual([d.width, d.height]);
  });

  it('copes with degenerate viewports', () => {
    for (const [w, h] of [[0, 0], [1, 1], [10, 5000], [5000, 10]]) {
      const l = computeLayout(w, h);
      expect(Number.isFinite(l.width) && Number.isFinite(l.height) && l.scale > 0).toBe(true);
    }
  });

  it('applyViewport updates the shared layout and reports whether the canvas size changed', () => {
    expect(applyViewport(390, 844)).toBe(true);
    const portrait = { w: layout.width, h: layout.height };
    expect(applyViewport(391, 845)).toBe(false);
    expect(layout.width).toBe(portrait.w);
    expect(applyViewport(844, 390)).toBe(true);
    expect(layout.orientation).toBe('landscape');
    expect(layout.boardY).toBe(0);
    applyViewport(720, 900); // restore for other tests
  });
});

describe('names under the avatars on every phone-shaped screen', () => {
  it('has room for all four names (the avatars shrink a little rather than lose a name), for every size between 360x700 and 600x1100', () => {
    const missing = [];
    for (const w of [360, 375, 390, 412, 430, 492, 540, 600]) {
      for (let h = 700; h <= 1100; h += 10) {
        const l = computeLayout(w, h);
        const a = l.hud.avatar;
        if (!a) continue;
        const slots = [[false, false], [true, false], [false, true], [true, true]].map(([r, b]) => a.nameSlot(r, b));
        if (!slots.every(Boolean)) missing.push(`${w}x${h}`);
        for (const s of slots.filter(Boolean)) expect((s.font ?? a.nameFont) * l.scale, `${w}x${h} name size`).toBeGreaterThanOrEqual(8.5);
        expect(a.size * l.scale, `${w}x${h} avatar size`).toBeGreaterThanOrEqual(35.5);
      }
    }
    expect(missing).toEqual([]);
  });
});