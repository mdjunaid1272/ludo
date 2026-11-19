import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POPUP_BODY_WIDTH, POPUP_BUTTONS, POPUP_CROP, POPUP_HEIGHT, POPUP_MADE_WIDTH } from '../src/config/setupPopup.js';
import { PLAYER_COUNTS } from '../src/game/settings.js';
import { decodePng } from '../tools/png.mjs';

describe('the "how many players?" popup picture', () => {
  const picture = decodePng(fs.readFileSync(new URL('../img/elements/setup-popup.png', import.meta.url)));

  it('is made at the size the game expects', () => {
    expect(picture.width).toBe(POPUP_MADE_WIDTH);
    expect(picture.height).toBe(POPUP_HEIGHT);
    expect(POPUP_HEIGHT / POPUP_MADE_WIDTH).toBeCloseTo(POPUP_CROP.h / POPUP_CROP.w, 2);
    expect(POPUP_BODY_WIDTH).toBeLessThan(POPUP_MADE_WIDTH);
  });

  it('has a tap area for each player count, in order, side by side and inside the picture', () => {
    expect(Object.keys(POPUP_BUTTONS).map(Number)).toEqual(PLAYER_COUNTS);
    const xs = PLAYER_COUNTS.map((n) => POPUP_BUTTONS[n].x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const n of PLAYER_COUNTS) {
      const b = POPUP_BUTTONS[n];
      expect(b.x - b.w / 2).toBeGreaterThan(0);
      expect(b.x + b.w / 2).toBeLessThan(picture.width);
      expect(b.y - b.h / 2).toBeGreaterThan(0);
      expect(b.y + b.h / 2).toBeLessThan(picture.height);
    }
    for (let i = 1; i < xs.length; i++) {
      const left = POPUP_BUTTONS[PLAYER_COUNTS[i - 1]];
      const right = POPUP_BUTTONS[PLAYER_COUNTS[i]];
      expect(left.x + left.w / 2).toBeLessThan(right.x - right.w / 2); // they do not overlap
    }
  });

  it('shows a button (light blue, not the dark blue of the board) where each tap area is', () => {
    for (const n of PLAYER_COUNTS) {
      const b = POPUP_BUTTONS[n];
      // a point in the button's top left part, away from its text
      const x = Math.round(b.x - b.w * 0.35);
      const y = Math.round(b.y - b.h * 0.3);
      const i = (y * picture.width + x) * 4;
      const [r, g, bl] = [picture.pixels[i], picture.pixels[i + 1], picture.pixels[i + 2]];
      expect(bl, `button ${n} is blue`).toBeGreaterThan(150);
      expect(g, `button ${n} is lighter than the board around it`).toBeGreaterThan(60);
      expect(r).toBeLessThan(120);
    }
  });
});
