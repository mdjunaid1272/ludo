import fs from 'node:fs';
import { decodePng, downscale, encodePng } from './png.mjs';

// Makes a smaller copy of a picture: node tools/shrinkImage.mjs <in.png> <out.png> <width>
// Used for pictures that are shown far smaller than their size (the Settings button is 1313 px wide and is drawn
// about 100 px wide); a copy near the drawn size looks sharper and loads faster than letting the graphics card shrink it.
const [input, output, widthArg] = process.argv.slice(2);
const width = Number(widthArg);
if (!input || !output || !Number.isFinite(width) || width < 8) {
  console.error('usage: node tools/shrinkImage.mjs <in.png> <out.png> <width>');
  process.exit(1);
}
const source = decodePng(fs.readFileSync(input));
const result = downscale(source, width / source.width);
fs.writeFileSync(output, encodePng(result));
console.log(`${input} (${source.width}x${source.height}) -> ${output} (${result.width}x${result.height}, ${fs.statSync(output).size} bytes)`);
