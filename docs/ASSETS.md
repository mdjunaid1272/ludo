# Pictures in img/elements

Your artwork in `img/elements` is used like this (`npm run build:elements` makes the files the game loads; the originals stay untouched):

| Original | Made file | Used for |
| --- | --- | --- |
| `ludo-board1.png` | `board.png` (960 x 960) | The board: yards, cells, home columns and centre. The picture's cells vary a little in size and it has a frame, so the tool warps it cell by cell onto an exact 15 x 15 grid (the grid lines were measured from the picture) and drops the frame. |
| `Red-Token.png`, `GreenToken.png`, `Yellow-Token.png`, `blue-token.png` | `token-red.png` ... (128 x 128) | The pieces, cropped to the piece. |
| `bg.png` | `bg-small.png` (half size) | The wooden background of the menu, settings, online and game screens (with a dark layer over it so text stays readable). |

How it fits the game:
- The board's coloured cells match the game's path data exactly (checked by `tests/boardPicture.test.js`).
- The four holes of each yard are where the pieces rest: `YARD_SLOTS` in `src/game/path.js` are the measured hole centres.
- **Perspective colours:** each screen paints its own seat in the colour that person asked for, so the board picture is repainted for that map (hue rotation of each colour family, white cells and grid lines untouched; made once per screen, `src/board/recolor.js`) and each piece uses the picture of the colour it is painted in.
- The board turns with the screen (your colour in the bottom left corner).
- If a picture does not load, the game draws the board and pieces with shapes as before.
- Changing the board art: replace `ludo-board1.png` (or point `buildBoard()` at another file); if its grid lines move, update `XS` and `YS` in `tools/buildElements.mjs` and the hole centres in `YARD_SLOTS`, then run `npm run build:elements`.