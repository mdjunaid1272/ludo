# Pictures in img/elements

Your artwork in `img/elements` is used like this (`npm run build:elements` makes the files the game loads; the originals stay untouched):

| Original | Made file | Used for |
| --- | --- | --- |
| `ludo-board3.png` | `board.png` (1000 x 1000) | The board: yards, cells, home columns and centre. `ludo-board3.png` is the same board as `ludo-board2.png` on a taller canvas of water: the board is cut out of it (it starts 468 rows down) and its water is cut out and replaced by moving water (below). The artwork has green top left, so it is turned a quarter clockwise to put the colours in the game's corners (red top left, then green, yellow, blue clockwise). Its stone cells vary a little in size and it is not centred, so the tool warps it cell by cell onto an exact 15 x 15 grid (the grid lines were measured from the turned picture) and keeps a small margin (`BOARD_MARGIN_CELLS` in `src/config/boardPicture.js`) so the yards' rims are not cut off; the game draws the picture that much bigger than the grid. |
| (made) | `water-base.png`, `water-light.png` (256 x 256) | The moving, wavy water. The blue water is cut out of `board.png` (see-through; found by flood-filling the blue from the picture's border, the blue yard panel and home column are kept) and two seamless pictures of water drift behind it, one up and one down (`src/board/drawWater.js`, made by `tools/waterTile.mjs`). A displacement filter bends both with a small wave map that is redrawn about 30 times a second, so the waves roll (WebGL only; without it the water drifts but does not bend). On tall screens the water goes on above and below the board, behind the avatars and dice. With "reduce motion" set in the system, the water stays still. |
| `Red-T.png`, `Green-T.png`, `Yellow-T.png`, `Blue-T.png` | `token-red.png` ... (128 x 128) | The pieces (gold-ringed pawns), cropped to the piece and centred in a square. |
| `dice-sheet.png` | `dice.png` (384 x 256) | The six faces of the die: 3 x 2 cells of 128 px (faces 1 2 3, then 4 5 6), each die cropped, made the same width and centred in its cell. `src/objects/Dice.js` shows the face picture with a ring in the current player's colour round it (thicker while the die waits for a roll); without the picture the die is drawn with shapes. |
| `bg.png` | `bg-small.png` (half size) | The wooden background of the menu, settings, online and game screens (with a dark layer over it so text stays readable). |

How it fits the game:
- The board's coloured cells match the game's path data exactly (checked by `tests/boardPicture.test.js`).
- The four holes of each yard are where the pieces rest: `YARD_SLOTS` in `src/game/path.js` are the measured hole centres.
- **Perspective colours:** each screen paints its own seat in the colour that person asked for, so the board picture is repainted for that map (hue rotation, made once per screen, `src/board/recolor.js`) and each piece uses the picture of the colour it is painted in. Only each colour's yard panel, home column, start cell and the centre are repainted (`src/board/boardRegions.js`), so the water, stone, grass and gold frames keep their look.
- The board turns with the screen (your colour in the bottom left corner).
- If a picture does not load, the game draws the board and pieces with shapes as before.
- The picture already has a star on five cells (`PICTURE_STAR_CELLS`); the game draws its own safe-cell stars only on the other cells.
- Changing the board art: replace `ludo-board3.png` (or point `buildBoard()` at another file); if its grid lines move, update `XS` and `YS` in `tools/buildElements.mjs`, the hole centres in `YARD_SLOTS`, the star cells and, if it is not turned the same way, the turn in `buildBoard()`; then run `npm run build:elements`.