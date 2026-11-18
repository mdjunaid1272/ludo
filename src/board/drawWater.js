import { WATER_BASE_IMAGE, WATER_LIGHT_IMAGE } from '../config/assets.js';

// The moving water behind the board. The board picture (img/elements/board.png) has its blue water cut out, so what shows through is
// two repeating water pictures that drift slowly, one up and one down: deep blue water, and thin bright ripples added on top of it.
// Returns the objects it made (to remove them), or [] when the pictures are not loaded or the person asked for less motion.
// The picture's size on screen (times its own) and how far it drifts per second, as [sideways, down]: the deep water drifts up,
// the ripples drift down. (A tile sprite's picture moves up the screen as its tile position grows.)
const BASE = { scale: 2.2, speed: [0, 10] };
const LIGHT = { scale: 1.6, speed: [0, -14] };
const ADD = 1; // Phaser's "add" blend mode
const BEHIND_BOARD = -10; // above the page background, below the board and everything on it

const wantsLessMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

// `x`, `y` is the middle of the square and `size` its width and height, in screen pixels.
export function drawWater(scene, x, y, size) {
  const hasPictures = scene.textures?.exists?.(WATER_BASE_IMAGE) && scene.textures.exists(WATER_LIGHT_IMAGE);
  if (!hasPictures || !scene.add?.tileSprite) return [];
  const base = scene.add.tileSprite(x, y, size, size, WATER_BASE_IMAGE).setDepth(BEHIND_BOARD).setTileScale(BASE.scale);
  const light = scene.add.tileSprite(x, y, size, size, WATER_LIGHT_IMAGE).setDepth(BEHIND_BOARD + 1).setTileScale(LIGHT.scale).setBlendMode(ADD);
  if (wantsLessMotion() || !scene.events?.on) return [base, light];
  // The pictures' own size matters: they drift by pixels of the picture, so a bigger picture on screen drifts faster on screen.
  const drift = (layer, { scale, speed }, seconds) => {
    layer.tilePositionX += (speed[0] * seconds) / scale;
    layer.tilePositionY += (speed[1] * seconds) / scale;
  };
  const update = (_time, delta) => {
    const seconds = Math.min(delta, 100) / 1000; // a long pause (a hidden tab) must not make the water jump
    drift(base, BASE, seconds);
    drift(light, LIGHT, seconds);
  };
  scene.events.on('update', update);
  scene.events.once('shutdown', () => scene.events.off('update', update));
  return [base, light];
}
