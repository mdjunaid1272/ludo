import { LEVELS } from './ai.js';
import { PLAYER_IDS } from './path.js';
import { DEFAULT_RULES, resolveRules } from './rules.js';

export const PLAYER_COUNTS = [2, 3, 4];
export const DEFAULT_DIFFICULTY = 'normal';

// The default colours for a local game with a given player count (two players sit opposite each other).
const PLAYER_SETS = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
};

// localColors: the colours of the last Local Multiplayer game (its length is the player count, `players`).
// vsPlayers / humanColor: the last Player vs Computer setup. Both pre-select the popup next time.
export const DEFAULT_SETTINGS = Object.freeze({
  players: 4,
  localColors: PLAYER_SETS[4],
  difficulty: DEFAULT_DIFFICULTY,
  vsPlayers: 2,
  humanColor: 'red',
  rules: DEFAULT_RULES,
});

export const playersFor = (count) => [...(PLAYER_SETS[count] ?? PLAYER_SETS[4])];

// True if `colors` is 2-4 distinct, valid player colours.
export const isValidColorSet = (colors) =>
  Array.isArray(colors) &&
  PLAYER_COUNTS.includes(colors.length) &&
  new Set(colors).size === colors.length &&
  colors.every((c) => PLAYER_IDS.includes(c));

// The seats of a Local Multiplayer game for the chosen colours, in turn order: clockwise round the board
// (red, green, yellow, blue), whatever order they were picked in.
export function localSeatsFor(colors) {
  if (!isValidColorSet(colors)) throw new Error(`Invalid colours for a local game: ${JSON.stringify(colors)}`);
  return PLAYER_IDS.filter((id) => colors.includes(id));
}

// The seats of a Player vs Computer game, in turn order. The person (`human` colour) sits first and so
// moves first; the others follow clockwise. With two players the computer sits opposite.
const SEAT_OFFSETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export function seatsFor(count, human) {
  const start = PLAYER_IDS.indexOf(human);
  const offsets = SEAT_OFFSETS[count];
  if (start < 0 || !offsets) throw new Error(`Invalid Player vs Computer setup: ${count} players, colour ${human}`);
  return offsets.map((o) => PLAYER_IDS[(start + o) % PLAYER_IDS.length]);
}

export const GAME_MODES = ['local', 'computer'];

// Which of `players` the computer controls. In Player vs Computer the person is the first seat (see
// seatsFor) and the computer plays all the others; in local multiplayer nobody is a computer.
export const computersFor = (mode, players) => (mode === 'computer' ? players.slice(1) : []);

// Turns anything (saved JSON, junk, null) into valid settings. Invalid fields fall back to defaults.
// `players` always equals the number of `localColors`.
export function normalizeSettings(raw) {
  let localColors;
  if (isValidColorSet(raw?.localColors)) localColors = localSeatsFor(raw.localColors);
  else localColors = playersFor(PLAYER_COUNTS.includes(raw?.players) ? raw.players : DEFAULT_SETTINGS.players);
  const difficulty = LEVELS.includes(raw?.difficulty) ? raw.difficulty : DEFAULT_DIFFICULTY;
  const vsPlayers = PLAYER_COUNTS.includes(raw?.vsPlayers) ? raw.vsPlayers : DEFAULT_SETTINGS.vsPlayers;
  const humanColor = PLAYER_IDS.includes(raw?.humanColor) ? raw.humanColor : DEFAULT_SETTINGS.humanColor;
  const rules = { ...DEFAULT_RULES };
  if (raw && typeof raw.rules === 'object' && raw.rules !== null) {
    for (const [key, value] of Object.entries(raw.rules)) {
      try {
        resolveRules({ [key]: value });
        rules[key] = value;
      } catch {
        // unknown rule or bad value: keep the default
      }
    }
  }
  return { players: localColors.length, localColors, difficulty, vsPlayers, humanColor, rules };
}

export const isDefaultRules = (rules) => Object.keys(DEFAULT_RULES).every((k) => rules[k] === DEFAULT_RULES[k]);

// One-line description for the menu, e.g. "4 players - classic rules - computer: normal".
export function summarizeSettings(settings) {
  const rules = isDefaultRules(settings.rules) ? 'classic rules' : 'custom rules';
  return `${settings.players} players - ${rules} - computer: ${settings.difficulty}`;
}

// The next value in `options` after `current`, wrapping round.
export function cycleOption(options, current) {
  const i = options.indexOf(current);
  return options[(i + 1) % options.length];
}
