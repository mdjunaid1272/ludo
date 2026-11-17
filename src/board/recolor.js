// Repaints the board picture for a perspective colour map. The picture has four coloured families (red, green, yellow and
// blue yards, lanes and triangles); each person sees their own seat in the colour they asked for, so a family is moved to
// another colour by rotating the hue of its pixels (brightness, shading and the white and black parts stay as they are).
// Pure functions on pixel arrays, so they are easy to test.

// The hue (degrees) of each family in the picture.
export const FAMILY_HUE = { red: 2, yellow: 50, green: 113, blue: 205 };
const FAMILIES = Object.keys(FAMILY_HUE);

const MIN_SATURATION = 0.3; // paler pixels (the white cells, shadows on them) are left alone
const MIN_VALUE = 0.2; // so are the near black ones (grid lines)

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// The family a hue belongs to (the nearest of the four).
export function familyOf(hue) {
  let best = FAMILIES[0];
  for (const f of FAMILIES) if (hueDistance(hue, FAMILY_HUE[f]) < hueDistance(hue, FAMILY_HUE[best])) best = f;
  return best;
}

// True when `mapping` ({ family: colour }) leaves every family as it is.
export const isIdentity = (mapping) => FAMILIES.every((f) => (mapping[f] ?? f) === f);

// A text key for a mapping, to cache the repainted picture under.
export const mappingKey = (mapping) => FAMILIES.map((f) => mapping[f] ?? f).join('-');

// Repaints `data` (RGBA bytes, changed in place): a pixel of family f becomes colour mapping[f]. Returns data.
export function recolor(data, mapping) {
  const shift = {};
  for (const f of FAMILIES) shift[f] = FAMILY_HUE[mapping[f] ?? f] - FAMILY_HUE[f];
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s < MIN_SATURATION || v < MIN_VALUE) continue;
    const delta = shift[familyOf(h)];
    if (delta === 0) continue;
    const [r, g, b] = hsvToRgb((h + delta + 360) % 360, s, v);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return data;
}
