import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { drawWater } from '../src/board/drawWater.js';
import { BOARD_IMAGE, WATER_BASE_IMAGE, WATER_LIGHT_IMAGE } from '../src/config/assets.js';
import { BOARD_MARGIN_CELLS, PICTURE_CELLS } from '../src/config/boardPicture.js';
import { HOME_LANE_CELLS, YARD_CORNER, YARD_SLOTS } from '../src/game/path.js';
import { decodePng } from '../tools/png.mjs';
import { makeWaterBase, makeWaterLight } from '../tools/waterTile.mjs';

// A recording stand-in for a scene with the water pictures loaded.
function waterScene({ keys = [WATER_BASE_IMAGE, WATER_LIGHT_IMAGE], withEvents = true } = {}) {
  const sprites = [];
  const listeners = new Map();
  const scene = {
    textures: { exists: (key) => keys.includes(key) },
    add: {
      tileSprite: (x, y, w, h, key) => {
        const sprite = {
          x, y, w, h, key, depth: 0, blend: 0, scale: 1, tilePositionX: 0, tilePositionY: 0,
          setDepth(d) { this.depth = d; return this; },
          setTileScale(s) { this.scale = s; return this; },
          setBlendMode(b) { this.blend = b; return this; },
        };
        sprites.push(sprite);
        return sprite;
      },
    },
  };
  if (withEvents) {
    scene.events = {
      on: (name, fn) => listeners.set(name, fn),
      once: (name, fn) => listeners.set(name, fn),
      off: (name) => listeners.delete(name),
    };
  }
  return { scene, sprites, listeners };
}

afterEach(() => vi.unstubAllGlobals());

describe('the moving water behind the board', () => {
  it('puts two water layers behind the board, the ripples added on top of the deep water', () => {
    const { scene, sprites } = waterScene();
    const made = drawWater(scene, 360, 700, 760);
    expect(made).toHaveLength(2);
    expect(sprites.map((s) => s.key)).toEqual([WATER_BASE_IMAGE, WATER_LIGHT_IMAGE]);
    for (const s of sprites) expect([s.x, s.y, s.w, s.h]).toEqual([360, 700, 760, 760]);
    expect(sprites[0].depth).toBeLessThan(0); // below the board
    expect(sprites[1].depth).toBeGreaterThan(sprites[0].depth);
    expect(sprites[1].blend).toBe(1); // "add"
    expect(sprites[0].blend).toBe(0);
  });

  it('makes the layers drift, in different directions, every frame', () => {
    const { scene, sprites, listeners } = waterScene();
    drawWater(scene, 0, 0, 100);
    listeners.get('update')(0, 1000); // one second
    expect(sprites[0].tilePositionX).toBeGreaterThan(0);
    expect(sprites[0].tilePositionY).toBeGreaterThan(0);
    expect(Math.sign(sprites[1].tilePositionX)).toBe(-Math.sign(sprites[0].tilePositionX));
    const before = sprites[0].tilePositionX;
    listeners.get('update')(0, 1000);
    expect(sprites[0].tilePositionX).toBeGreaterThan(before);
  });

  it('does not jump after a long pause (a hidden tab)', () => {
    const { scene, sprites, listeners } = waterScene();
    drawWater(scene, 0, 0, 100);
    listeners.get('update')(0, 60000);
    const long = sprites[0].tilePositionX;
    const other = waterScene();
    drawWater(other.scene, 0, 0, 100);
    other.listeners.get('update')(0, 100);
    expect(long).toBeCloseTo(other.sprites[0].tilePositionX, 6);
  });

  it('stops moving when the scene shuts down', () => {
    const { scene, listeners } = waterScene();
    drawWater(scene, 0, 0, 100);
    expect(listeners.has('update')).toBe(true);
    listeners.get('shutdown')();
    expect(listeners.has('update')).toBe(false);
  });

  it('keeps the water still when the person asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { scene, sprites, listeners } = waterScene();
    expect(drawWater(scene, 0, 0, 100)).toHaveLength(2);
    expect(sprites).toHaveLength(2);
    expect(listeners.has('update')).toBe(false);
  });

  it('draws nothing when the water pictures are not loaded', () => {
    const { scene, sprites } = waterScene({ keys: [] });
    expect(drawWater(scene, 0, 0, 100)).toEqual([]);
    expect(sprites).toHaveLength(0);
    expect(drawWater({ textures: { exists: () => true }, add: {} }, 0, 0, 100)).toEqual([]); // no tile sprites to make
  });

  it('is part of drawing the board, as big as the board picture', () => {
    const sprites = [];
    const g = new Proxy({}, { get: () => () => g });
    const scene = {
      textures: { exists: (key) => [BOARD_IMAGE, WATER_BASE_IMAGE, WATER_LIGHT_IMAGE].includes(key), get: () => ({ getSourceImage: () => ({ width: 4, height: 4 }) }) },
      add: {
        graphics: () => g,
        image: () => ({ setDisplaySize() { return this; }, setAngle() { return this; } }),
        tileSprite: (x, y, w, h, key) => {
          const s = { key, w, h, setDepth() { return this; }, setTileScale() { return this; }, setBlendMode() { return this; } };
          sprites.push(s);
          return s;
        },
      },
    };
    drawBoard(scene, { makeText: () => ({ setOrigin() { return this; } }) });
    expect(sprites).toHaveLength(2);
    expect(sprites[0].w).toBeGreaterThan(sprites[0].h * 0.99); // a square...
    expect(sprites[0].w).toBeLessThan(sprites[0].h * 1.01);
  });
});

describe('the water pictures (tools/waterTile.mjs)', () => {
  const lastToFirstJump = (tile) => {
    // how much a picture changes between its last column and its first one, against how much it changes between neighbours
    const { width, height, pixels } = tile;
    let wrap = 0;
    let neighbour = 0;
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < 4; c++) {
        wrap = Math.max(wrap, Math.abs(pixels[(y * width + width - 1) * 4 + c] - pixels[y * width * 4 + c]));
        for (let x = 1; x < width; x++) neighbour = Math.max(neighbour, Math.abs(pixels[(y * width + x) * 4 + c] - pixels[(y * width + x - 1) * 4 + c]));
      }
    }
    return { wrap, neighbour };
  };

  it('repeat without a seam', () => {
    for (const tile of [makeWaterBase(), makeWaterLight()]) {
      const { wrap, neighbour } = lastToFirstJump(tile);
      expect(wrap).toBeLessThanOrEqual(neighbour);
    }
  });

  it('are deep blue water that is fully solid, and ripples that are mostly see-through', () => {
    const base = makeWaterBase();
    let alpha = 0;
    for (let i = 0; i < base.width * base.height; i++) {
      alpha = Math.min(alpha || 255, base.pixels[i * 4 + 3]);
      expect(base.pixels[i * 4 + 2]).toBeGreaterThan(base.pixels[i * 4 + 1]);
      expect(base.pixels[i * 4 + 2]).toBeGreaterThan(base.pixels[i * 4]);
    }
    expect(alpha).toBe(255);
    const light = makeWaterLight();
    const clear = Array.from({ length: light.width * light.height }, (_, i) => light.pixels[i * 4 + 3]).filter((a) => a < 20).length;
    expect(clear / (light.width * light.height)).toBeGreaterThan(0.6);
  });
});

describe('the board picture with its water cut out', () => {
  const picture = decodePng(fs.readFileSync(new URL('../img/elements/board.png', import.meta.url)));
  const perCell = picture.width / PICTURE_CELLS;
  const alphaAt = (cx, cy) => picture.pixels[(Math.round((cy + BOARD_MARGIN_CELLS) * perCell) * picture.width + Math.round((cx + BOARD_MARGIN_CELLS) * perCell)) * 4 + 3];

  it('is see-through where the water is (the outer corner, between the yards and the arms)', () => {
    expect(picture.pixels[3]).toBe(0); // the very corner
    expect(alphaAt(5.0, 5.6)).toBe(0); // between the red yard and the top arm
    expect(alphaAt(10.6, 5.6)).toBe(0); // between the green yard and the right arm
    expect(alphaAt(5.5, 12)).toBe(0); // between the blue yard and the bottom arm
    expect(alphaAt(9.8, 9.6)).toBe(0); // between the yellow yard and the bottom arm
    expect(alphaAt(14.8, 14.8)).toBe(0); // the outer margin
    expect(alphaAt(4.0, 5.5)).toBe(0); // the pocket of water beside the red yard that the border cannot reach
  });

  it('is solid on the stone cells, the home columns, the centre and every yard panel (the blue ones are as blue as the water)', () => {
    expect(alphaAt(6.5, 3.5)).toBe(255); // a stone cell
    expect(alphaAt(7.5, 7.5)).toBe(255); // the centre
    for (const color of Object.keys(YARD_CORNER)) {
      for (const [dx, dy] of YARD_SLOTS[color]) expect(alphaAt(YARD_CORNER[color][0] + dx, YARD_CORNER[color][1] + dy), `${color} yard hole`).toBe(255);
      for (const [c, r] of HOME_LANE_CELLS[color]) expect(alphaAt(c + 0.15, r + 0.15), `${color} lane ${c},${r}`).toBe(255);
    }
  });
});
