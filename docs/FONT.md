# The picture font

All text in the game is drawn with a picture font made from `img/spritefont/spritefont-sheet-1.png` (cream letters with a
blue outline).

## What it can show

Upper-case letters, digits and these symbols: `! ? . , : ; - _ + x / ( ) @ # $ %`, plus a space. The apostrophe and quotes
are drawn as a raised comma. There are no lower-case letters (text is upper-cased as it is drawn), and no `=`, `<`, `>`,
`&`, `*`, `|` or accented letters: a character the font lacks is not drawn. In development a console warning names it
(`Sprite font has no "="`), and `tests/spriteFont.test.js` checks every label the game uses.

## How it is made

`npm run build:font` (`tools/buildSpriteFont.mjs`) finds each glyph in the sheet and writes two bitmap fonts into
`img/spritefont/`: `font-lg` (half size, for text drawn at 44 px or more) and `font-sm` (quarter size, for the rest). Two
sizes keep the graphics card from shrinking the 170 px glyphs 6x or more, which looks jagged. The output is committed, so
the command is only needed after changing the sheet. Letter spacing is `GAP` in that script (negative: outlines overlap a
little).

## How the game uses it

- `src/ui/SpriteText.js`: `addText(scene, x, y, text, style)` replaces `scene.add.text`. It understands `fontSize`,
  `color` (a tint), `align` and `wordWrap.width`; font family, bold and stroke are ignored.
- `src/config/textMetrics.js`: `TEXT_SCALE` (drawn size relative to the size asked for) and `GLYPH_WIDTH` (average width of
  a character). The layout code (`estimateTextWidth` in `src/config/layout.js`) uses these to size text to its space.
  If you change the font or its spacing, re-measure `GLYPH_WIDTH`; `tests/spriteFont.test.js` fails when the estimate is
  smaller than the real width of the game's labels.
- Colours: the font is tinted, so a colour multiplies cream and blue. Light colours look right; very dark ones make the
  letters blotchy.
- The fonts are loaded by `BootScene`. A scene that draws text without going through `BootScene` (such as the tools in
  `tools/`) must load them first.
