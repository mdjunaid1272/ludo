// Facts about the game's picture font (img/spritefont, see tools/buildSpriteFont.mjs) that the layout code needs
// without loading any pictures. All text in the game is drawn with that font.

// The font is chunky: its glyph boxes (with the outline) are taller than an ordinary font's letters. A text asked for at
// "fontSize 30" is drawn at TEXT_SCALE * 30 so that it looks about as big as before.
export const TEXT_SCALE = 1;

// Width of an upper-case character with the outline, as a fraction of the drawn size. Measured from the font:
// A-Z average 0.75, ordinary sentences about 0.67-0.70 (the space is narrow), short words of wide letters up to 0.80.
// The layout fits text with the larger figure, so a line of capitals does not overflow.
export const GLYPH_WIDTH = 0.8;

// Text drawn at or above this size (in game pixels) uses the large copy of the font, everything smaller the small
// one, so no picture is ever squeezed by much more than 2x.
export const BIG_TEXT_FROM = 44;
