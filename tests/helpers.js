// Deterministic helpers for tests.
import { GameState } from '../src/game/GameState.js';

// An rng that makes rollDice() return exactly `value` (1-6).
export const rngFor = (value) => () => (value - 1) / 6 + 0.01;

// Small seeded PRNG (mulberry32) for reproducible random games.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a state with the given token progress values, e.g. { red: [3, -1, -1, -1] }.
// Unlisted colours keep all tokens in the yard. `turn` is the colour to move first.
export function makeState({ tokens = {}, turn = 'red', rules, players } = {}) {
  const g = new GameState({ rules, players });
  for (const [color, list] of Object.entries(tokens)) g.tokens[color] = [...list];
  g.turn = g.players.indexOf(turn);
  return g;
}

// Rolls `value` and, if a move is possible and `token` is given, plays it.
export function play(g, value, token) {
  g.rollDice(rngFor(value));
  const result = token === undefined ? null : g.moveToken(token);
  return result;
}

