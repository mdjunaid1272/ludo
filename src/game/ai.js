import { FINISHED, IN_YARD, LAST_TRACK_STEP, SAFE_INDICES, TRACK_LENGTH, absIndexFor } from './path.js';

// Computer players. Pure functions over a GameState: they only read it, never change it.
//
//   easy   - picks a random legal move.
//   normal - scores each legal move (finish, capture, leave the yard, reach a safe cell, avoid danger),
//            but adds a lot of randomness to the scores, so it often (not always) plays a sensible move.
//   hard   - the same scoring with no randomness: always the best-scoring move.
//
// Ludo is mostly dice, so a smarter scoring function barely beats a decent one (in tests, a re-tuned "hard"
// scoring was no better than "normal" on fresh games). The levels are therefore separated by how often
// the AI errs, which gives clear tiers. Measured win rates are asserted in tests/ai.test.js.

export const LEVELS = ['easy', 'normal', 'hard'];

const SCORING = { leaveYard: 40, finish: 100, enterLane: 60, progress: 0.3, safe: 18, capture: 130, captureValue: 0.8, danger: 2, escape: 30, stack: 0 };
const WEIGHTS = {
  normal: { ...SCORING, noise: 90 },
  hard: { ...SCORING, noise: 0 },
};

// Picks which token to move for the current roll. Returns a token index, or null if there is no legal move.
// `rng` returns a number in [0, 1); inject one for repeatable choices.
// level is a level name, or a weights object (used to tune the AI).
export function chooseMove(state, level = 'normal', rng = Math.random) {
  const moves = state.legalMoves();
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  if (level === 'easy') return moves[Math.floor(rng() * moves.length)];

  const weights = typeof level === 'object' ? level : (WEIGHTS[level] ?? WEIGHTS.normal);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const index of moves) {
    const score = scoreMove(state, index, weights) + (weights.noise ? rng() * weights.noise : 0);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

function scoreMove(state, index, w) {
  const me = state.currentPlayer;
  const from = state.tokens[me][index];
  const to = from === IN_YARD ? 0 : from + state.roll;
  let score = to * w.progress;

  if (from === IN_YARD) score += w.leaveYard;
  if (to === FINISHED) score += w.finish;
  else if (to > LAST_TRACK_STEP && from <= LAST_TRACK_STEP) score += w.enterLane;

  const abs = absIndexFor(me, to);
  if (abs !== null) {
    if (SAFE_INDICES.has(abs)) {
      score += w.safe;
    } else {
      for (const other of state.players) {
        if (other === me) continue;
        for (const p of state.tokens[other]) {
          if (absIndexFor(other, p) === abs) score += w.capture + p * w.captureValue;
        }
      }
      score -= w.danger * threatsAt(state, me, abs) * (10 + to * 0.4);
    }
    if (state.tokens[me].some((p, i) => i !== index && absIndexFor(me, p) === abs)) score += w.stack;
  }

  // Moving a token that is currently in danger is worth something.
  const fromAbs = absIndexFor(me, from);
  if (fromAbs !== null && !SAFE_INDICES.has(fromAbs)) score += w.escape * threatsAt(state, me, fromAbs);
  return score;
}

// How many opponent tokens could reach track cell `abs` with a single roll (1-6 steps behind it).
function threatsAt(state, me, abs) {
  let count = 0;
  for (const other of state.players) {
    if (other === me) continue;
    for (const p of state.tokens[other]) {
      const theirAbs = absIndexFor(other, p);
      if (theirAbs === null) continue;
      const distance = (abs - theirAbs + TRACK_LENGTH) % TRACK_LENGTH;
      if (distance >= 1 && distance <= 6 && p + distance <= LAST_TRACK_STEP) count++;
    }
  }
  return count;
}


