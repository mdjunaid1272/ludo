import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { BOARD_BOTTOM_IMAGE, BOARD_IMAGE, BOARD_TOP_IMAGE } from '../src/config/assets.js';
import { BOARD_MARGIN_CELLS, PICTURE_CELLS } from '../src/config/boardPicture.js';
import { BOARD, computeLayout, layout } from '../src/config/layout.js';
import { decodePng } from '../tools/png.mjs';

// A recording stand-in for a scene that has the board picture (and, unless `strips` is false, the two water pictures) loaded.
function stripScene({ strips = true } = {}) {
  const images = [];
  const g = new Proxy({}, { get: () => () => g });
  const keys = [BOARD_IMAGE, ...(strips ? [BOARD_TOP_IMAGE, BOARD_BOTTOM_IMAGE] : [])];
  const scene = {
    textures: { exists: (key) => keys.includes(key), get: () => ({ getSourceImage: () => ({ width: 4, height: 4 }) }) },
    add: {
      graphics: () => g,
      image: (x, y, key) => {
        const image = {
          x, y, key, width: 1000, height: key === BOARD_TOP_IMAGE ? 378 : key === BOARD_BOTTOM_IMAGE ? 373 : 1000, originY: 0.5, size: null,
          setOrigin(_x, oy) { this.originY = oy; return this; },
          setDisplaySize(w, h) { this.size = [w, h]; return this; },
          setAngle() { return this; },
        };
        images.push(image);
        return image;
      },
    },
  };
  return { scene, images, makeText: () => ({ setOrigin() { return this; } }) };
}

const withLayout = (width, height, run) => {
  const original = { ...layout };
  try {
    Object.assign(layout, computeLayout(width, height));
    run();
  } finally {
    Object.assign(layout, original);
  }
};

describe('the water of the board artwork above and below the board', () => {
  it('is drawn above and below the board picture on a tall screen, as wide as the picture and not squashed', () => {
    withLayout(720, 1500, () => {
      expect(layout.orientation).toBe('portrait');
      const { scene, images, makeText } = stripScene();
      drawBoard(scene, { makeText });
      const [board, top, bottom] = images;
      expect([board.key, top.key, bottom.key]).toEqual([BOARD_IMAGE, BOARD_TOP_IMAGE, BOARD_BOTTOM_IMAGE]); // after the board: drawn over its margin
      const shown = (BOARD * PICTURE_CELLS) / 15;
      expect(top.size[0]).toBeCloseTo(shown, 6);
      expect(top.size[1]).toBeCloseTo((378 / 1000) * shown, 6);
      expect(bottom.size[1]).toBeCloseTo((373 / 1000) * shown, 6);
      const middleY = layout.boardY + BOARD / 2;
      const overlap = BOARD_MARGIN_CELLS * (BOARD / 15);
      expect(top.y).toBeCloseTo(middleY - shown / 2 + overlap, 6); // its lower edge lies over the picture's top margin
      expect(top.originY).toBe(1);
      expect(bottom.y).toBeCloseTo(middleY + shown / 2 - overlap, 6);
      expect(bottom.originY).toBe(0);
    });
  });

  it('is left out on a wide screen, and when its pictures are not loaded', () => {
    withLayout(1400, 700, () => {
      expect(layout.orientation).toBe('landscape');
      const { scene, images, makeText } = stripScene();
      drawBoard(scene, { makeText });
      expect(images.map((i) => i.key)).toEqual([BOARD_IMAGE]);
    });
    withLayout(720, 1500, () => {
      const { scene, images, makeText } = stripScene({ strips: false });
      drawBoard(scene, { makeText });
      expect(images.map((i) => i.key)).toEqual([BOARD_IMAGE]);
    });
  });
});

describe('the water pictures (img/elements/board-top.png and board-bottom.png)', () => {
  const board = decodePng(fs.readFileSync(new URL('../img/elements/board.png', import.meta.url)));
  const top = decodePng(fs.readFileSync(new URL('../img/elements/board-top.png', import.meta.url)));
  const bottom = decodePng(fs.readFileSync(new URL('../img/elements/board-bottom.png', import.meta.url)));
  const alpha = (im, x, y) => im.pixels[(y * im.width + x) * 4 + 3];

  it('are as wide as the board picture, and are cut from the artwork\'s water in its proportions (468 rows above, 461 below, of 1226 wide)', () => {
    expect(top.width).toBe(board.width);
    expect(bottom.width).toBe(board.width);
    expect(top.height / top.width).toBeCloseTo(464 / 1226, 2);
    expect(bottom.height / bottom.width).toBeCloseTo(457 / 1226, 2);
  });

  it('are solid, except at the edge next to the board, which fades out to nothing over the picture\'s margin', () => {
    const fade = Math.round(BOARD_MARGIN_CELLS * (board.width / PICTURE_CELLS));
    expect(alpha(top, 100, 0)).toBe(255);
    expect(alpha(top, 100, top.height - fade - 1)).toBe(255);
    expect(alpha(top, 100, top.height - 1)).toBeLessThan(40);
    expect(alpha(top, 100, top.height - fade / 2)).toBeGreaterThan(80);
    expect(alpha(top, 100, top.height - fade / 2)).toBeLessThan(200);
    expect(alpha(bottom, 100, bottom.height - 1)).toBe(255);
    expect(alpha(bottom, 100, 0)).toBeLessThan(40);
    expect(alpha(bottom, 100, fade + 1)).toBe(255);
  });

  it('are deep blue water', () => {
    for (const strip of [top, bottom]) {
      const i = ((strip.height >> 1) * strip.width + (strip.width >> 1)) * 4;
      expect(strip.pixels[i + 2]).toBeGreaterThan(strip.pixels[i] + 40);
    }
  });
});
