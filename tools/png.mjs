import { crc32, deflateSync, inflateSync } from 'node:zlib';

// A tiny PNG reader/writer for the sprite-font tool (8-bit RGBA, no interlacing: what the sheet uses).

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  for (let pos = 8; pos < buffer.length; ) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || ![3, 6].includes(colorType) || data[12] !== 0) throw new Error('only 8-bit palette or RGBA, non-interlaced PNGs are supported');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : 4; // bytes per pixel in the file
  const stride = width * bpp;
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? lines[y * stride + x - bpp] : 0;
      const up = y > 0 ? lines[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? lines[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      lines[y * stride + x] = value & 255;
    }
  }
  if (colorType === 6) return { width, height, pixels: lines };
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const index = lines[i];
    pixels[i * 4] = palette[index * 3];
    pixels[i * 4 + 1] = palette[index * 3 + 1];
    pixels[i * 4 + 2] = palette[index * 3 + 2];
    pixels[i * 4 + 3] = transparency && index < transparency.length ? transparency[index] : 255;
  }
  return { width, height, pixels };
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

export function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter 0 (none)
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Shrinks an image by `factor` (< 1), averaging every source pixel under each new pixel (premultiplied by alpha, so
// soft edges do not pick up dark halos). Used so the font is not squeezed 6x by the graphics card at draw time.
export function downscale({ width, height, pixels }, factor) {
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const sx = width / w;
  const sy = height / h;
  const tmp = new Float64Array(w * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const a = x * sx;
      const b = (x + 1) * sx;
      let r = 0, g = 0, bl = 0, al = 0;
      for (let i = Math.floor(a); i < Math.ceil(b) && i < width; i++) {
        const wt = Math.min(b, i + 1) - Math.max(a, i);
        const o = (y * width + i) * 4;
        const alpha = pixels[o + 3] / 255;
        r += pixels[o] * alpha * wt; g += pixels[o + 1] * alpha * wt; bl += pixels[o + 2] * alpha * wt; al += alpha * wt;
      }
      const t = (y * w + x) * 4;
      tmp[t] = r / sx; tmp[t + 1] = g / sx; tmp[t + 2] = bl / sx; tmp[t + 3] = al / sx;
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const a = y * sy;
      const b = (y + 1) * sy;
      let r = 0, g = 0, bl = 0, al = 0;
      for (let j = Math.floor(a); j < Math.ceil(b) && j < height; j++) {
        const wt = Math.min(b, j + 1) - Math.max(a, j);
        const t = (j * w + x) * 4;
        r += tmp[t] * wt; g += tmp[t + 1] * wt; bl += tmp[t + 2] * wt; al += tmp[t + 3] * wt;
      }
      al /= sy;
      const o = (y * w + x) * 4;
      if (al > 0) {
        out[o] = Math.min(255, Math.round(r / sy / al));
        out[o + 1] = Math.min(255, Math.round(g / sy / al));
        out[o + 2] = Math.min(255, Math.round(bl / sy / al));
      }
      out[o + 3] = Math.min(255, Math.round(al * 255));
    }
  }
  return { width: w, height: h, pixels: out };
}

// Writes the image as an indexed (palette) PNG with at most `maxColors` colours, found by median cut. Pictures with
// smooth shading and a transparent background (the avatars) shrink to a fraction of their full-colour size.
export function encodeIndexedPng({ width, height, pixels }, maxColors = 256) {
  // Count the distinct colours (kept at 5 bits for red, green and blue and 4 for alpha, to keep the count small).
  const unique = new Map();
  const keyOf = (o) => ((pixels[o] >> 3) << 13) | ((pixels[o + 1] >> 3) << 8) | ((pixels[o + 2] >> 3) << 3) | (pixels[o + 3] >> 5);
  const keys = new Uint32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const k = keyOf(i * 4);
    keys[i] = k;
    const e = unique.get(k);
    if (e) { e.n++; e.r += pixels[i * 4]; e.g += pixels[i * 4 + 1]; e.b += pixels[i * 4 + 2]; e.a += pixels[i * 4 + 3]; }
    else unique.set(k, { key: k, n: 1, r: pixels[i * 4], g: pixels[i * 4 + 1], b: pixels[i * 4 + 2], a: pixels[i * 4 + 3] });
  }
  const colours = [...unique.values()].map((e) => ({ key: e.key, n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n, e.a / e.n] }));
  // Median cut: keep splitting the box with the widest spread, at its weighted middle, until there are enough boxes.
  let boxes = [colours];
  const spread = (box) => {
    let best = { ch: 0, range: -1 };
    for (let ch = 0; ch < 4; ch++) {
      let lo = 255;
      let hi = 0;
      for (const e of box) { lo = Math.min(lo, e.c[ch]); hi = Math.max(hi, e.c[ch]); }
      if (hi - lo > best.range) best = { ch, range: hi - lo };
    }
    return best;
  };
  while (boxes.length < maxColors) {
    let pick = -1;
    let pickRange = 0;
    boxes.forEach((box, i) => { if (box.length > 1) { const s = spread(box); if (s.range * Math.log2(1 + box.length) > pickRange) { pickRange = s.range * Math.log2(1 + box.length); pick = i; } } });
    if (pick < 0) break;
    const box = boxes[pick];
    const { ch } = spread(box);
    box.sort((a, b) => a.c[ch] - b.c[ch]);
    const total = box.reduce((s, e) => s + e.n, 0);
    let run = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) { run += box[i].n; cut = i + 1; if (run >= total / 2) break; }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  const paletteOf = new Map();
  const palette = boxes.map((box, index) => {
    const total = box.reduce((s, e) => s + e.n, 0);
    const c = [0, 1, 2, 3].map((ch) => Math.round(box.reduce((s, e) => s + e.c[ch] * e.n, 0) / total));
    for (const e of box) paletteOf.set(e.key, index);
    return c;
  });
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * stride + 1 + x] = paletteOf.get(keys[y * width + x]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3; // indexed colour
  const plte = Buffer.from(palette.flatMap((c) => [c[0], c[1], c[2]]));
  const trns = Buffer.from(palette.map((c) => c[3]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}