// Static board model, in grid units on the 15x15 board.
// Cell centres use +0.5 so they can be passed straight to gridToPixel().

// The 52 shared track cells [col, row], clockwise, starting at red's start cell.
export const TRACK_CELLS = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

export const TRACK_LENGTH = TRACK_CELLS.length; // 52

// Index in the track where each colour enters the board.
export const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

// Five home-column cells per colour, ordered from the outside in.
export const HOME_LANE_CELLS = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

// Where tokens rest on the centre triangle once finished (grid units, not cell-aligned).
export const HOME_SPOT = {
  red: [6.8, 7.5],
  green: [7.5, 6.8],
  yellow: [8.2, 7.5],
  blue: [7.5, 8.2],
};

// Token spots inside each yard, as offsets from the yard corner, one set per colour: they are the four holes of that yard in the
// board picture (img/elements/board.png, measured from it), which sit a little towards the board's outer corner.
export const YARD_SLOTS = {
  red: [[1.64, 1.71], [3.53, 1.71], [1.64, 3.62], [3.53, 3.62]],
  green: [[2.38, 1.74], [4.27, 1.74], [2.38, 3.65], [4.27, 3.65]],
  yellow: [[2.4, 2.45], [4.24, 2.45], [2.4, 4.34], [4.24, 4.34]],
  blue: [[1.64, 2.41], [3.52, 2.41], [1.64, 4.28], [3.52, 4.28]],
};
export const YARD_CORNER = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

// Progress values: -1 = in yard, 0..50 = on the shared track (relative to the
// colour's start), 51..55 = home column, 56 = finished.
export const PLAYER_IDS = Object.keys(START_INDEX); // clockwise turn order

export const IN_YARD = -1;
export const LAST_TRACK_STEP = 50;
export const FINISHED = 56;

const centre = ([c, r]) => ({ gx: c + 0.5, gy: r + 0.5 });

// Grid position of a token for a given colour, progress and token index (yard spot).
export function positionFor(color, progress, tokenIndex) {
  if (progress === IN_YARD) {
    const [cc, cr] = YARD_CORNER[color];
    const [dx, dy] = YARD_SLOTS[color][tokenIndex];
    return { gx: cc + dx, gy: cr + dy };
  }
  if (progress <= LAST_TRACK_STEP) {
    return centre(TRACK_CELLS[(START_INDEX[color] + progress) % TRACK_LENGTH]);
  }
  if (progress < FINISHED) return centre(HOME_LANE_CELLS[color][progress - 51]);
  const [hx, hy] = HOME_SPOT[color];
  // Fan finished tokens out slightly (along the triangle's edge) so they don't hide each other.
  const spread = (tokenIndex - 1.5) * 0.1;
  const horizontal = color === 'red' || color === 'yellow';
  return horizontal ? { gx: hx, gy: hy + spread } : { gx: hx + spread, gy: hy };
}

// Absolute track index (0..51) of a token on the shared track, or null if it is not on it.
export function absIndexFor(color, progress) {
  if (progress < 0 || progress > LAST_TRACK_STEP) return null;
  return (START_INDEX[color] + progress) % TRACK_LENGTH;
}

// Safe cells: every colour's start cell plus the "star" cell 8 steps after it.
// Tokens on a safe cell cannot be captured.
export const STAR_INDICES = Object.values(START_INDEX).map((s) => s + 8);
export const SAFE_INDICES = new Set([...Object.values(START_INDEX), ...STAR_INDICES]);

// Grid position (cell centre) of an absolute track index.
export const trackCellCentre = (abs) => centre(TRACK_CELLS[abs]);

