# Pictures in img/elements

Your artwork in `img/elements` is used like this (`npm run build:elements` makes the files the game loads; the originals stay untouched):

| Original | Made file | Used for |
| --- | --- | --- |
| `ludo-board2.png` | `board.png` (1000 x 1000) | The board: yards, cells, home columns and centre. The artwork has green top left, so it is turned a quarter clockwise to put the colours in the game's corners (red top left, then green, yellow, blue clockwise). Its stone cells vary a little in size and it is not centred, so the tool warps it cell by cell onto an exact 15 x 15 grid (the grid lines were measured from the turned picture) and keeps a small margin (`BOARD_MARGIN_CELLS` in `src/config/boardPicture.js`) so the yards' rims are not cut off; the game draws the picture that much bigger than the grid. |
| `Red-Token.png`, `GreenToken.png`, `Yellow-Token.png`, `blue-token.png` | `token-red.png` ... (128 x 128) | The pieces, cropped to the piece. |
| `bg.png` | `bg-small.png` (half size) | The wooden background of the menu, settings, online and game screens (with a dark layer over it so text stays readable). |

How it fits the game:
- The board's coloured cells match the game's path data exactly (checked by `tests/boardPicture.test.js`).
- The four holes of each yard are where the pieces rest: `YARD_SLOTS` in `src/game/path.js` are the measured hole centres.
- **Perspective colours:** each screen paints its own seat in the colour that person asked for, so the board picture is repainted for that map (hue rotation, made once per screen, `src/board/recolor.js`) and each piece uses the picture of the colour it is painted in. Only each colour's yard panel, home column, start cell and the centre are repainted (`src/board/boardRegions.js`), so the water, stone, grass and gold frames keep their look.
- The board turns with the screen (your colour in the bottom left corner).
- If a picture does not load, the game draws the board and pieces with shapes as before.
- The picture already has a star on five cells (`PICTURE_STAR_CELLS`); the game draws its own safe-cell stars only on the other cells.
- Changing the board art: replace `ludo-board2.png` (or point `buildBoard()` at another file); if its grid lines move, update `XS` and `YS` in `tools/buildElements.mjs`, the hole centres in `YARD_SLOTS`, the star cells and, if it is not turned the same way, the turn in `buildBoard()`; then run `npm run build:elements`.