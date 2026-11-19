import { WATER_BASE_IMAGE, WATER_LIGHT_IMAGE } from '../config/assets.js';

// The moving, wavy water behind the board. The board picture (img/elements/board.png) has its blue water cut out, so what shows through
// is two repeating water pictures: deep blue water drifting up, and thin bright ripples added on top of it, drifting down. Each is
// also bent by a displacement filter whose map (a small canvas) is redrawn about 30 times a second with waves travelling through it,
// so the water looks like it is rolling. Returns the objects it made, or [] when the pictures are not loaded.
// Without WebGL (no filters) or when the person asked for less motion, the water is still or only drifts.
const BASE = { scale: 2.2, speed: [0, 10] }; // the picture's size on screen (times its own) and how far it drifts per second, [sideways, down]
const LIGHT = { scale: 1.6, speed: [0, -14] }; // (a tile sprite's picture moves up the screen as its tile position grows)
const ADD = 1; // Phaser's "add" blend mode
const BEHIND_BOARD = -10; // above the page background, below the board and everything on it

const MAP_SIZE = 96; // pixels of the wave map (it is stretched over the water, so the waves are smooth)
const MAP_KEY = 'water-wave-map';
const WAVE_PX = 7; // how far the water is bent at most, in screen pixels
const WAVE_STEP_MS = 33; // the wave map is redrawn at most this often
const TAU = Math.PI * 2;

const wantsLessMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

// Fills the wave map for time `t` (seconds): two numbers per pixel (red = sideways, green = up and down), 128 meaning "not moved".
// Every wave has a whole number of repeats across the map and moves with t, so the waves roll through it.
export function fillWaveMap(data, size, t) {
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const dx = Math.sin(TAU * (3 * u + 0.16 * t) + 1.3 * Math.sin(TAU * (2 * v - 0.11 * t)));
      const dy = Math.sin(TAU * (3 * v - 0.13 * t) + 1.1 * Math.sin(TAU * (2 * u + 0.09 * t)));
      const i = (y * size + x) * 4;
      data[i] = 128 + 127 * dx;
      data[i + 1] = 128 + 127 * dy;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return data;
}

// A wave map the scene can use as a displacement map, or null when this scene cannot make one (no canvas, no WebGL).
function makeWaveMap(scene) {
  const textures = scene.textures;
  if (!textures?.createCanvas || scene.sys?.game?.renderer?.type !== 2) return null; // 2 is Phaser.WEBGL
  if (textures.exists(MAP_KEY)) textures.remove(MAP_KEY);
  const map = textures.createCanvas(MAP_KEY, MAP_SIZE, MAP_SIZE);
  if (!map?.context) return null;
  const image = map.context.createImageData(MAP_SIZE, MAP_SIZE);
  const redraw = (t) => {
    fillWaveMap(image.data, MAP_SIZE, t);
    map.context.putImageData(image, 0, 0);
    map.refresh();
  };
  redraw(0);
  return { key: MAP_KEY, redraw, destroy: () => textures.remove(MAP_KEY) };
}

// `x`, `y` is the middle of the water and `width` and `height` its size (a square when `height` is left out), in screen pixels.
export function drawWater(scene, x, y, width, height = width) {
  const hasPictures = scene.textures?.exists?.(WATER_BASE_IMAGE) && scene.textures.exists(WATER_LIGHT_IMAGE);
  if (!hasPictures || !scene.add?.tileSprite) return [];
  const base = scene.add.tileSprite(x, y, width, height, WATER_BASE_IMAGE).setDepth(BEHIND_BOARD).setTileScale(BASE.scale);
  const light = scene.add.tileSprite(x, y, width, height, WATER_LIGHT_IMAGE).setDepth(BEHIND_BOARD + 1).setTileScale(LIGHT.scale).setBlendMode(ADD);
  if (wantsLessMotion() || !scene.events?.on) return [base, light];

  // The waves: bend both layers with the same, moving, map.
  let waves = null;
  try {
    waves = makeWaveMap(scene);
    if (waves) {
      const amount = (2 * WAVE_PX) / Math.min(width, height); // the filter moves pixels by up to half of this much of the object's size
      for (const layer of [base, light]) {
        layer.enableFilters?.();
        const filter = layer.filters?.internal?.addDisplacement(waves.key, amount, amount);
        filter?.setPaddingOverride?.(null); // so the edges of the water are not cut by the bending
      }
    }
  } catch {
    waves = null; // a graphics card without what the filter needs: the water drifts, but does not bend
  }

  // The pictures' own size matters: they drift by pixels of the picture, so a bigger picture on screen drifts faster on screen.
  const drift = (layer, { scale, speed }, seconds) => {
    layer.tilePositionX += (speed[0] * seconds) / scale;
    layer.tilePositionY += (speed[1] * seconds) / scale;
  };
  let clock = 0;
  let sinceWaves = WAVE_STEP_MS;
  const update = (_time, delta) => {
    const seconds = Math.min(delta, 100) / 1000; // a long pause (a hidden tab) must not make the water jump
    clock += seconds;
    drift(base, BASE, seconds);
    drift(light, LIGHT, seconds);
    sinceWaves += Math.min(delta, 100);
    if (waves && sinceWaves >= WAVE_STEP_MS) {
      sinceWaves = 0;
      waves.redraw(clock);
    }
  };
  scene.events.on('update', update);
  scene.events.once('shutdown', () => {
    scene.events.off('update', update);
    waves?.destroy();
  });
  return [base, light];
}
