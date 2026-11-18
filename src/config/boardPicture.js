// Facts about the board picture (img/elements/board.png) that both the picture builder (tools/buildElements.mjs) and the game share.

// The picture shows the 15 x 15 cells and a little more round them (the artwork's yards and track ends reach a bit outside the grid).
// This is how much more, in cells, on every side. The picture is drawn that much bigger than the board, so the cells still line up.
export const BOARD_MARGIN_CELLS = 0.3125;

// How many cells wide and high the whole picture is.
export const PICTURE_CELLS = 15 + 2 * BOARD_MARGIN_CELLS;

// Cells whose safe-cell star is already part of the artwork (the four star cells and the yellow start cell); the game does not draw
// its own star on top of these. [column, row] on the unturned board.
export const PICTURE_STAR_CELLS = [[6, 2], [12, 6], [2, 8], [8, 12], [13, 8]];
