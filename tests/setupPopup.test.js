import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POPUPS, POPUP_MADE_WIDTH } from '../src/config/setupPopup.js';
import { PLAYER_COUNTS } from '../src/game/settings.js';
import { decodePng } from '../tools/png.mjs';

describe('the "how many players?" popup pictures', () => {
  it('exist for Player vs Computer and Local Multiplayer (Play Online has no count step)', () => {
    expect(Object.keys(POPUPS)).toEqual(['computer', 'local']);
  });

  for (const [mode, popup] of Object.entries(POPUPS)) {
    describe(mode, () => {
      const picture = decodePng(fs.readFileSync(new URL(`../img/elements/${popup.name}`, import.meta.url)));
      const original = decodePng(fs.readFileSync(new URL(`../img/UI boards/${popup.source.split('/').pop()}`, import.meta.url)));

      it('is cut from inside the original and made at the size the game expects', () => {
        const { x, y, w, h } = popup.crop;
        expect(x + w).toBeLessThanOrEqual(original.width);
        expect(y + h).toBeLessThanOrEqual(original.height);
        expect(picture.width).toBe(POPUP_MADE_WIDTH);
        expect(picture.height).toBe(popup.height);
        expect(popup.height / POPUP_MADE_WIDTH).toBeCloseTo(h / w, 2);
        expect(popup.bodyWidth).toBeLessThan(POPUP_MADE_WIDTH);
      });

      it('has a tap area for each player count, in order, side by side and inside the picture', () => {
        expect(Object.keys(popup.buttons).map(Number)).toEqual(PLAYER_COUNTS);
        const xs = PLAYER_COUNTS.map((n) => popup.buttons[n].x);
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
        for (const n of PLAYER_COUNTS) {
          const b = popup.buttons[n];
          expect(b.x - b.w / 2).toBeGreaterThan(0);
          expect(b.x + b.w / 2).toBeLessThan(picture.width);
          expect(b.y - b.h / 2).toBeGreaterThan(0);
          expect(b.y + b.h / 2).toBeLessThan(picture.height);
        }
        for (let i = 1; i < xs.length; i++) {
          const left = popup.buttons[PLAYER_COUNTS[i - 1]];
          const right = popup.buttons[PLAYER_COUNTS[i]];
          expect(left.x + left.w / 2).toBeLessThan(right.x - right.w / 2); // they do not overlap
        }
      });

      it('shows a button (blue, lighter than the board around it) where each tap area is', () => {
        for (const n of PLAYER_COUNTS) {
          const b = popup.buttons[n];
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
  }
});
