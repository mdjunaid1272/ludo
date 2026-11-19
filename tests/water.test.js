import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawBoard } from '../src/board/drawBoard.js';
import { drawWater, fillWaveMap } from '../src/board/drawWater.js';
import { BOARD_IMAGE, WATER_BASE_IMAGE, WATER_LIGHT_IMAGE } from '../src/config/assets.js';
import { BOARD_MARGIN_CELLS, PICTURE_CELLS } from '../src/config/boardPicture.js';
import { BOARD, computeLayout, layout } from '../src/config/layout.js';
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

  it('makes the layers drift up and down (the water up, the ripples down), every frame, never sideways', () => {
    const { scene, sprites, listeners } = waterScene();
    drawWater(scene, 0, 0, 100);
    listeners.get('update')(0, 1000); // one second
    // a tile's position grows as the picture moves up the screen
    expect(sprites[0].tilePositionY).toBeGreaterThan(0);
    expect(sprites[1].tilePositionY).toBeLessThan(0);
    for (const s of sprites) expect(s.tilePositionX).toBe(0);
    const before = sprites[0].tilePositionY;
    listeners.get('update')(0, 1000);
    expect(sprites[0].tilePositionY).toBeGreaterThan(before);
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

  it('can be taller than it is wide (water above and below the board)', () => {
    const { scene, sprites } = waterScene();
    drawWater(scene, 360, 750, 720, 1000);
    for (const s of sprites) expect([s.x, s.y, s.w, s.h]).toEqual([360, 750, 720, 1000]);
  });

  it('goes on above and below the board on a tall screen, behind the rows of avatars and dice, and stays on the screen', () => {
    const sprites = [];
    const g = new Proxy({}, { get: () => () => g });
    const scene = {
      textures: { exists: (key) => [BOARD_IMAGE, WATER_BASE_IMAGE, WATER_LIGHT_IMAGE].includes(key), get: () => ({ getSourceImage: () => ({ width: 4, height: 4 }) }) },
      add: {
        graphics: () => g,
        image: () => ({ setDisplaySize() { return this; }, setAngle() { return this; } }),
        tileSprite: (x, y, w, h, key) => {
          const s = { key, x, y, w, h, setDepth() { return this; }, setTileScale() { return this; }, setBlendMode() { return this; } };
          sprites.push(s);
          return s;
        },
      },
    };
    const original = { ...layout };
    try {
      Object.assign(layout, computeLayout(720, 1500));
      drawBoard(scene, { makeText: () => ({ setOrigin() { return this; } }) });
      const [water] = sprites;
      expect(layout.orientation).toBe('portrait');
      expect(water.h).toBeGreaterThan((BOARD * PICTURE_CELLS) / 15); // taller than the board picture
      const top = water.y - water.h / 2;
      const bottom = water.y + water.h / 2;
      expect(top).toBeGreaterThan(0);
      expect(bottom).toBeLessThan(layout.height);
      expect(layout.boardY - top).toBeGreaterThan(layout.boardY - layout.hud.diceSpot(false, false).y); // reaches past the top row of dice
      expect(layout.boardY - top).toBeLessThanOrEqual(BOARD * (468 / 1283) + 0.001); // never more than the picture's own water
      expect(water.y).toBeCloseTo(layout.boardY + BOARD / 2, 5); // the same distance above as below
      expect(water.w).toBeGreaterThanOrEqual(layout.width);
    } finally {
      Object.assign(layout, original);
    }
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

describe('the waves bending the water', () => {
  const size = 32;
  const map = (t) => fillWaveMap(new Uint8ClampedArray(size * size * 4), size, t);

  it('fill the map with a sideways and an up-and-down amount around "not moved" (128), solid', () => {
    const data = map(0);
    let low = 255;
    let high = 0;
    for (let i = 0; i < size * size; i++) {
      for (const c of [0, 1]) {
        low = Math.min(low, data[i * 4 + c]);
        high = Math.max(high, data[i * 4 + c]);
      }
      expect(data[i * 4 + 3]).toBe(255);
    }
    expect(low).toBeLessThan(40);
    expect(high).toBeGreaterThan(215);
  });

  it('move with time (the waves roll), and come back round to the same map after their period', () => {
    const a = map(0);
    const b = map(1.3);
    expect(a.some((v, i) => v !== b[i])).toBe(true);
    // each wave repeats a whole number of times across the map, so no edge of the map ever shows a seam
    let wrap = 0;
    let neighbour = 0;
    for (let y = 0; y < size; y++) {
      wrap = Math.max(wrap, Math.abs(a[(y * size + size - 1) * 4] - a[y * size * 4]));
      for (let x = 1; x < size; x++) neighbour = Math.max(neighbour, Math.abs(a[(y * size + x) * 4] - a[(y * size + x - 1) * 4]));
    }
    expect(wrap).toBeLessThanOrEqual(neighbour);
  });

  it('are made once per scene, redrawn while it runs, and removed on shutdown', () => {
    const { scene, listeners } = waterScene();
    const canvases = new Map();
    const redraws = [];
    scene.sys = { game: { renderer: { type: 2 } } };
    scene.textures.exists = (key) => [WATER_BASE_IMAGE, WATER_LIGHT_IMAGE].includes(key) || canvases.has(key);
    scene.textures.remove = (key) => canvases.delete(key);
    scene.textures.createCanvas = (key) => {
      canvases.set(key, true);
      return {
        context: { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => redraws.push('put') },
        refresh: () => redraws.push('refresh'),
      };
    };
    const filters = [];
    const origin = scene.add.tileSprite;
    scene.add.tileSprite = (...args) => {
      const sprite = origin(...args);
      sprite.enableFilters = () => {};
      sprite.filters = { internal: { addDisplacement: (key, x, y) => { filters.push({ key, x, y }); return { setPaddingOverride() {} }; } } };
      return sprite;
    };
    drawWater(scene, 0, 0, 700, 1000);
    expect(canvases.size).toBe(1);
    expect(filters).toHaveLength(2); // both layers are bent
    expect(filters[0].key).toBe(filters[1].key);
    expect(filters[0].x).toBeGreaterThan(0);
    const before = redraws.length;
    listeners.get('update')(0, 40); // a frame later than the wave step
    expect(redraws.length).toBeGreaterThan(before);
    const afterFirst = redraws.length;
    listeners.get('update')(0, 5); // too soon for another redraw
    expect(redraws.length).toBe(afterFirst);
    listeners.get('shutdown')();
    expect(canvases.size).toBe(0);
  });

  it('are left out (the water still drifts) when this scene cannot do them', () => {
    const { scene, sprites, listeners } = waterScene(); // no canvas textures, no renderer
    expect(drawWater(scene, 0, 0, 100)).toHaveLength(2);
    expect(sprites).toHaveLength(2);
    expect(listeners.has('update')).toBe(true);
  });
});
