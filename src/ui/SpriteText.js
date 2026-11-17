import Phaser from 'phaser';
import { FONT_LARGE, FONT_SMALL } from '../config/assets.js';
import { BIG_TEXT_FROM, TEXT_SCALE } from '../config/textMetrics.js';

const ALIGN = { left: 0, center: 1, right: 2 };
const warned = new Set();

// Text drawn with the game's picture font. The font only has upper-case letters, so text is upper-cased as it is set,
// and setColor() tints (the font's own colours are cream with a blue outline; a tint multiplies them).
export class SpriteText extends Phaser.GameObjects.BitmapText {
  setText(value) {
    const text = String(value ?? '').toUpperCase();
    if (import.meta.env?.DEV) this.warnAboutMissingGlyphs(text);
    return super.setText(text);
  }

  // Accepts the CSS colour strings the rest of the code uses: '#rrggbb', or '#rrggbbaa' (the last pair is opacity).
  setColor(css) {
    const hex = String(css ?? '#ffffff').replace('#', '');
    this.setTint(parseInt(hex.slice(0, 6), 16));
    if (hex.length === 8) this.setAlpha(parseInt(hex.slice(6, 8), 16) / 255);
    return this;
  }

  // Development only: a character the font does not have is silently skipped by Phaser, so say so once. (Not a #private
  // method: Phaser calls setText from inside its constructor, before private members exist.)
  warnAboutMissingGlyphs(text) {
    const chars = this.fontData?.chars;
    if (!chars) return;
    for (const ch of text) {
      if (ch === '\n' || chars[ch.charCodeAt(0)] || warned.has(ch)) continue;
      warned.add(ch);
      console.warn(`Sprite font has no "${ch}" (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}); it will not be drawn.`);
    }
  }
}

// Creates a text with the same arguments as scene.add.text(x, y, text, style), for the style fields the game uses:
//   fontSize ('30px' or 30), color, align ('left' | 'center' | 'right'), wordWrap: { width }.
// Font family, bold and stroke are ignored: the picture font has its own look and outline.
export function addText(scene, x, y, text, style = {}) {
  const size = parseFloat(style.fontSize ?? 16) * TEXT_SCALE;
  const font = size >= BIG_TEXT_FROM ? FONT_LARGE : FONT_SMALL;
  const label = new SpriteText(scene, x, y, font, '', size, ALIGN[style.align] ?? 0);
  label.setText(text);
  if (style.color && style.color.toLowerCase() !== '#ffffff') label.setColor(style.color);
  if (style.wordWrap?.width) label.setMaxWidth(style.wordWrap.width);
  scene.add.existing(label);
  return label;
}
