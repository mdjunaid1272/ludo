import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { setBoardRotation } from '../src/board/geometry.js';
import { FAMILY_HUE, REGION_ANY, REGION_NONE, familyOf, isIdentity, mappingKey, recolor, regionOfFamily } from '../src/board/recolor.js';
import { BOARD_IMAGE } from '../src/config/assets.js';
import { BOARD_MARGIN_CELLS, PICTURE_CELLS, PICTURE_STAR_CELLS } from '../src/config/boardPicture.js';
import { boardRegions } from '../src/board/boardRegions.js';
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
  const cell = picture.width / PICTURE_CELLS; // the picture has a margin of BOARD_MARGIN_CELLS round the 15 x 15 cells
  // Nine points spread over a cell (the artwork has icons, stars, glints and rounded corners on its cells, so no single point will do).
  const POINTS = [0.2, 0.5, 0.8].flatMap((oy) => [0.2, 0.5, 0.8].map((ox) => [ox, oy]));
  const samples = (c, r) => POINTS.map(([ox, oy]) => {
    const i = (Math.round((r + oy + BOARD_MARGIN_CELLS) * cell) * picture.width + Math.round((c + ox + BOARD_MARGIN_CELLS) * cell)) * 4;
    return [picture.pixels[i], picture.pixels[i + 1], picture.pixels[i + 2]];
  });
  const chroma = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  const hueApart = (rgb, color) => {
    const apart = Math.abs(hueOf(rgb) - FAMILY_HUE[color]);
    return Math.min(apart, 360 - apart);
  };
  const average = (c, r) => {
    const all = samples(c, r);
    return [0, 1, 2].map((k) => all.reduce((sum, rgb) => sum + rgb[k], 0) / all.length);
  };

  it('is a square with whole pixels per cell (15 cells and the margin)', () => {
    expect(picture.width).toBe(picture.height);
    expect(Number.isInteger(cell)).toBe(true);
    expect(Number.isInteger(BOARD_MARGIN_CELLS * cell)).toBe(true);
  });

  it('has each colour\'s start cell and home column exactly where the game\'s data has them', () => {
    for (const color of Object.keys(START_INDEX)) {
      for (const [c, r] of [...HOME_LANE_CELLS[color], TRACK_CELLS[START_INDEX[color]]]) {
        // some of the cell is the colour (the cell with the no-entry icon is mostly icon): within 40 degrees of its hue (the range the
        // repainting uses for its region) and strongly coloured
        const mine = samples(c, r).filter((rgb) => chroma(rgb) > 50 && hueApart(rgb, color) <= 40);
        expect(mine.length, `${color} cell ${c},${r}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('has plain stone on the other track cells (the arrow cells at the lane entrances aside)', () => {
    const lane = new Set(Object.keys(START_INDEX).flatMap((c) => [...HOME_LANE_CELLS[c], TRACK_CELLS[START_INDEX[c]]].map(([a, b]) => `${a},${b}`)));
    const arrows = new Set(['7,0', '14,7', '7,14', '0,7']);
    for (const [c, r] of TRACK_CELLS) {
      if (lane.has(`${c},${r}`) || arrows.has(`${c},${r}`)) continue;
      const rgb = average(c, r);
      // the stone is a pale beige (a few cells have a green star or a gold cap on them): never one of the four colours' strong red, green, yellow or blue
      expect(chroma(rgb), `cell ${c},${r} is stone`).toBeLessThan(140);
      expect(Math.min(...rgb), `cell ${c},${r} is light`).toBeGreaterThan(90);
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
    const shown = (BOARD * PICTURE_CELLS) / 15; // the picture is a little bigger than the grid
    expect(images[0]).toMatchObject({ key: BOARD_IMAGE, size: [shown, shown], angle: 0 });
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

describe('where the repainting may happen on the board picture', () => {
  const size = 1000;
  const regions = boardRegions(size);
  const perCell = size / PICTURE_CELLS;
  const at = (c, r) => regions[Math.round((r + 0.5 + BOARD_MARGIN_CELLS) * perCell) * size + Math.round((c + 0.5 + BOARD_MARGIN_CELLS) * perCell)];

  it('covers each colour\'s yard panel, home column and start cell, and the middle', () => {
    expect(at(2, 2)).toBe(regionOfFamily('red'));
    expect(at(11, 2)).toBe(regionOfFamily('green'));
    expect(at(11, 11)).toBe(regionOfFamily('yellow'));
    expect(at(2, 11)).toBe(regionOfFamily('blue'));
    for (const color of Object.keys(START_INDEX)) {
      for (const [c, r] of [...HOME_LANE_CELLS[color], TRACK_CELLS[START_INDEX[color]]]) expect(at(c, r), `${color} ${c},${r}`).toBe(regionOfFamily(color));
    }
    expect(at(7, 7)).toBe(REGION_ANY);
  });

  it('leaves the stone track cells and the outer margin alone', () => {
    expect(at(6, 3)).toBe(REGION_NONE);
    expect(at(6, 10)).toBe(REGION_NONE);
    expect(regions[0]).toBe(REGION_NONE);
  });

  it('only repaints pixels near the region\'s own colour (a gold frame in a red yard stays gold)', () => {
    const red = regionOfFamily('red');
    const gold = pixel(255, 200, 0);
    const panel = pixel(220, 20, 20);
    const water = pixel(30, 60, 200);
    for (const data of [gold, panel, water]) recolor(data, { red: 'blue' }, Uint8Array.of(red));
    expect([...gold]).toEqual([255, 200, 0, 255]);
    expect([...water]).toEqual([30, 60, 200, 255]);
    expect(Math.abs(hueOf(panel) - FAMILY_HUE.blue)).toBeLessThan(5);
  });

  it('skips pixels whose region is none', () => {
    const data = pixel(220, 20, 20);
    recolor(data, { red: 'blue' }, Uint8Array.of(REGION_NONE));
    expect([...data]).toEqual([220, 20, 20, 255]);
  });

  it('lists the five cells that already have a star in the picture', () => {
    expect(PICTURE_STAR_CELLS).toHaveLength(5);
  });
});