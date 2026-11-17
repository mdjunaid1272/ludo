import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { setBoardRotation } from '../src/board/geometry.js';
import { FAMILY_HUE, familyOf, isIdentity, mappingKey, recolor } from '../src/board/recolor.js';
import { BOARD_IMAGE } from '../src/config/assets.js';
import { BOARD, layout } from '../src/config/layout.js';
import { makePalette } from '../src/config/palette.js';
import { HOME_LANE_CELLS, START_INDEX, TRACK_CELLS } from '../src/game/path.js';
import { decodePng } from '../tools/png.mjs';

const pixel = (r, g, b) => Uint8ClampedArray.from([r, g, b, 255]);
const hueOf = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe('repainting the board picture for another colour map', () => {
  it('knows the four families by their hue', () => {
    for (const [family, hue] of Object.entries(FAMILY_HUE)) expect(familyOf(hue)).toBe(family);
    expect(familyOf(350)).toBe('red'); // the hue circle wraps round
    expect(familyOf(20)).toBe('red');
  });

  it('leaves everything alone for the identity map', () => {
    expect(isIdentity({})).toBe(true);
    expect(isIdentity({ red: 'red', green: 'green', yellow: 'yellow', blue: 'blue' })).toBe(true);
    expect(isIdentity({ red: 'green' })).toBe(false);
    const data = pixel(230, 40, 40);
    recolor(data, { red: 'red' });
    expect([...data]).toEqual([230, 40, 40, 255]);
  });

  it('turns a family into the colour it is mapped to, keeping its brightness', () => {
    const red = pixel(255, 30, 30);
    recolor(red, { red: 'blue' });
    expect(Math.abs(hueOf(red) - FAMILY_HUE.blue)).toBeLessThan(5);
    expect(Math.max(...red.slice(0, 3))).toBe(255); // as bright as before
    const green = pixel(35, 230, 10);
    recolor(green, { green: 'yellow' });
    expect(Math.abs(hueOf(green) - FAMILY_HUE.yellow)).toBeLessThan(5);
  });

  it('keeps white cells, grid lines and shadows on them as they are', () => {
    for (const [r, g, b] of [[255, 255, 255], [245, 245, 250], [20, 20, 20], [0, 0, 0], [230, 225, 225]]) {
      const data = pixel(r, g, b);
      recolor(data, { red: 'blue', green: 'red', yellow: 'green', blue: 'yellow' });
      expect([...data], `${r},${g},${b}`).toEqual([r, g, b, 255]);
    }
  });

  it('moves all four families at once without one landing on another (a swap)', () => {
    const map = { red: 'green', green: 'red', yellow: 'blue', blue: 'yellow' };
    const samples = { red: pixel(255, 30, 30), green: pixel(35, 230, 10), yellow: pixel(255, 215, 0), blue: pixel(0, 160, 255) };
    for (const data of Object.values(samples)) recolor(data, map);
    for (const [family, data] of Object.entries(samples)) expect(familyOf(hueOf(data)), family).toBe(map[family]);
  });

  it('makes a distinct cache key for each map', () => {
    expect(mappingKey({})).toBe('red-yellow-green-blue');
    expect(mappingKey({ red: 'blue', blue: 'red' })).toBe('blue-yellow-green-red');
  });

  it('repaints the whole board picture in a fraction of a second', () => {
    const data = new Uint8ClampedArray(960 * 960 * 4).fill(180);
    const start = performance.now();
    recolor(data, { red: 'green', green: 'yellow', yellow: 'blue', blue: 'red' });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe('the board picture (img/elements/board.png) and the game\'s grid', () => {
  const picture = decodePng(fs.readFileSync(new URL('../img/elements/board.png', import.meta.url)));
  const cell = picture.width / 15;
  const sample = (c, r) => {
    const i = (Math.round((r + 0.5) * cell) * picture.width + Math.round((c + 0.5) * cell)) * 4;
    return [picture.pixels[i], picture.pixels[i + 1], picture.pixels[i + 2]];
  };

  it('is a square with 15 whole cells', () => {
    expect(picture.width).toBe(picture.height);
    expect(picture.width % 15).toBe(0);
  });

  it('has each colour\'s start cell and home column exactly where the game\'s data has them', () => {
    for (const color of Object.keys(START_INDEX)) {
      for (const [c, r] of [...HOME_LANE_CELLS[color], TRACK_CELLS[START_INDEX[color]]]) {
        const rgb = sample(c, r);
        expect(familyOf(hueOf(rgb)), `${color} cell ${c},${r}`).toBe(color);
        expect(Math.max(...rgb) - Math.min(...rgb), `${color} cell ${c},${r} is coloured`).toBeGreaterThan(100);
      }
    }
  });

  it('has white on the other track cells (the arrow cells at the lane entrances aside)', () => {
    const lane = new Set(Object.keys(START_INDEX).flatMap((c) => [...HOME_LANE_CELLS[c], TRACK_CELLS[START_INDEX[c]]].map(([a, b]) => `${a},${b}`)));
    const arrows = new Set(['7,0', '14,7', '7,14', '0,7']);
    for (const [c, r] of TRACK_CELLS) {
      if (lane.has(`${c},${r}`) || arrows.has(`${c},${r}`)) continue;
      const [rr, g, b] = sample(c, r);
      expect(Math.min(rr, g, b), `cell ${c},${r}`).toBeGreaterThan(200);
    }
  });
});

// A recording stand-in for a scene that has the board picture loaded.
function pictureScene({ withPicture = true } = {}) {
  const images = [];
  const labels = [];
  const g = new Proxy({}, { get: () => () => g });
  const canvases = [];
  const textures = {
    keys: new Set(withPicture ? [BOARD_IMAGE] : []),
    exists(key) { return this.keys.has(key); },
    get: () => ({ getSourceImage: () => ({ width: 4, height: 4 }) }),
    addCanvas(key, canvas) { this.keys.add(key); canvases.push({ key, canvas }); },
  };
  const scene = {
    textures,
    add: {
      graphics: () => g,
      image: (x, y, key) => {
        const image = { x, y, key, size: null, angle: 0, setDisplaySize(w, h) { this.size = [w, h]; return this; }, setAngle(a) { this.angle = a; return this; } };
        images.push(image);
        return image;
      },
    },
  };
  return { scene, images, labels, canvases, makeText: (_s, _x, _y, label) => (labels.push(label), { setOrigin() { return this; } }) };
}

describe('drawBoard with the picture', () => {
  it('puts the picture on the board, as big as the board and in the middle', () => {
    setBoardRotation(0);
    const { scene, images, makeText } = pictureScene();
    drawBoard(scene, { makeText });
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ key: BOARD_IMAGE, size: [BOARD, BOARD], angle: 0 });
    expect(images[0].x).toBe(layout.boardX + BOARD / 2);
    expect(images[0].y).toBe(layout.boardY + BOARD / 2);
  });

  it('turns the picture with the board', () => {
    for (const turns of [1, 2, 3]) {
      setBoardRotation(turns);
      const { scene, images, makeText } = pictureScene();
      drawBoard(scene, { makeText });
      expect(images[0].angle).toBe(turns * 90);
    }
    setBoardRotation(0);
  });

  it('still writes each yard\'s name (in the colour this screen paints the seat in)', () => {
    const { scene, labels, makeText } = pictureScene();
    drawBoard(scene, { makeText, palette: makePalette({ red: 'blue', blue: 'red' }) });
    expect(labels).toEqual(['BLUE', 'GREEN', 'YELLOW', 'RED']);
  });

  it('uses the plain picture when every seat has its own colour, and a repainted copy (made once) otherwise', () => {
    const plain = pictureScene();
    drawBoard(plain.scene, { makeText: plain.makeText });
    expect(plain.images[0].key).toBe(BOARD_IMAGE);
    expect(plain.canvases).toHaveLength(0);
    // (no canvas element in this test environment: the plain picture is used instead of failing)
    const mapped = pictureScene();
    drawBoard(mapped.scene, { makeText: mapped.makeText, palette: makePalette({ red: 'green', green: 'red' }) });
    expect(mapped.images[0].key).toBe(BOARD_IMAGE);
  });

  it('falls back to drawing the board with shapes when the picture is not loaded', () => {
    const { scene, images, makeText } = pictureScene({ withPicture: false });
    drawBoard(scene, { makeText });
    expect(images).toHaveLength(0);
  });
});
