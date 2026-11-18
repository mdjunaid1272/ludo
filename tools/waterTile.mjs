// Makes the two seamless water pictures the game scrolls behind the board (see src/board/drawWater.js):
//   water-base   opaque deep blue water with soft lighter and darker patches
//   water-light  see-through, with thin bright ripple lines (drawn on top of the base, added to it, moving the other way)
// Both repeat without a seam: every wave in them has a whole number of repeats across the picture.
const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// The two wave fields, each from -1 to 1 (u and v run from 0 to 1 over the picture).
const waveA = (u, v) => Math.sin(TAU * (3 * u + 2 * v) + 1.3 * Math.sin(TAU * (2 * u - 3 * v)));
const waveB = (u, v) => Math.sin(TAU * (2 * u - 5 * v) + 1.7 * Math.sin(TAU * (4 * u + v)));
const patch = (u, v) => 0.5 + 0.5 * Math.sin(TAU * (u + 2 * v) + 2 * Math.sin(TAU * (2 * u - v)));

export function makeWaterBase(size = 256) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const p = patch(u, v) * 0.6 + (waveA(u, v) * 0.5 + 0.5) * 0.4;
      const i = (y * size + x) * 4;
      pixels[i] = mix(18, 52, p);
      pixels[i + 1] = mix(48, 112, p);
      pixels[i + 2] = mix(176, 238, p);
      pixels[i + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

export function makeWaterLight(size = 256) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // thin bright lines where the two waves cancel each other out
      const c = (waveA(u, v) + waveB(u, v)) / 2;
      const line = Math.pow(1 - smooth(0, 0.16, Math.abs(c)), 1.5);
      const i = (y * size + x) * 4;
      pixels[i] = 200;
      pixels[i + 1] = 240;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(line * 150);
    }
  }
  return { width: size, height: size, pixels };
}
