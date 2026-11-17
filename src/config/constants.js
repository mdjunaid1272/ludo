// Shared constants. The size and position of the board and HUD depend on the screen: see layout.js.
export const GRID = 15; // classic Ludo board is 15x15 cells
export const CELL = 48;
export const BOARD_SIZE = GRID * CELL; // 720

export const COLORS = {
  background: 0x1b1f2a,
  boardFrame: 0xffffff,
  cell: 0xffffff,
  line: 0x2b2f3a,
  red: 0xe53935,
  green: 0x43a047,
  yellow: 0xfdd835,
  blue: 0x1e88e5,
};

// Player identity, label and colour. Board geometry lives in game/path.js.
export const PLAYERS = [
  { id: 'red', label: 'RED', color: COLORS.red },
  { id: 'green', label: 'GREEN', color: COLORS.green },
  { id: 'yellow', label: 'YELLOW', color: COLORS.yellow },
  { id: 'blue', label: 'BLUE', color: COLORS.blue },
];


// Draw order. Higher draws on top. Modals live above all of these (see ui/Modal.js).
export const UI_DEPTH = { marker: 5, token: 10, tokenMoving: 20, effect: 30 };

