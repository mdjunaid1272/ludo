import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, downscale, encodeIndexedPng } from './png.mjs';

// Makes small copies of the avatar pictures: every img/avatars/*.png becomes img/avatars-small/<same name>.png, 128 px
// wide. The avatars are drawn about 45-100 px wide, so a copy near that size looks sharper (and loads faster) than letting
// the graphics card shrink a 400 px picture. The game reads the small copies, so drop a new picture into img/avatars/ and
// run `npm run build:avatars`; it becomes one of the avatars players can get.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'img', 'avatars');
const TO = path.join(ROOT, 'img', 'avatars-small');
const WIDTH = 128;

fs.mkdirSync(TO, { recursive: true });
const wanted = new Set();
for (const name of fs.readdirSync(FROM).filter((n) => n.toLowerCase().endsWith('.png')).sort()) {
  const source = decodePng(fs.readFileSync(path.join(FROM, name)));
  const small = downscale(source, WIDTH / source.width);
  fs.writeFileSync(path.join(TO, name), encodeIndexedPng(small));
  wanted.add(name);
  console.log(`${name}: ${source.width}x${source.height} -> ${small.width}x${small.height}`);
}
// A picture that was removed from img/avatars/ is removed from the small copies too.
for (const name of fs.readdirSync(TO)) if (name.toLowerCase().endsWith('.png') && !wanted.has(name)) fs.rmSync(path.join(TO, name));
