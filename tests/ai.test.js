import { describe, it, expect } from 'vitest';
import { chooseMove, LEVELS } from '../src/game/ai.js';
import { GameState, PHASE } from '../src/game/GameState.js';
import { FINISHED, START_INDEX } from '../src/game/path.js';
import { makeState, rngFor, seeded } from './helpers.js';

const at = (color, abs) => (abs - START_INDEX[color] + 52) % 52;
// A rolled state ready for the AI to choose.
const rolled = (value, options) => {
  const g = makeState(options);
  g.rollDice(rngFor(value));
  return g;
};

describe('chooseMove basics', () => {
  it('returns null when there is no legal move and the only move when there is one', () => {
    const none = rolled(3, {});
    expect(none.phase).toBe(PHASE.END);
    for (const level of LEVELS) expect(chooseMove(none, level)).toBeNull();
    const one = rolled(3, { tokens: { red: [10, -1, -1, -1] } });
    for (const level of LEVELS) expect(chooseMove(one, level)).toBe(0);
  });

  it('never changes the game state', () => {
    const g = rolled(6, { tokens: { red: [10, 20, -1, -1], green: [at('green', 12), -1, -1, -1] } });
    const before = JSON.stringify(g);
    for (const level of LEVELS) chooseMove(g, level);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('is repeatable for a given rng, and the easy level really is random', () => {
    const g = rolled(6, { tokens: { red: [10, 20, -1, -1] } });
    expect(chooseMove(g, 'normal', seeded(1))).toBe(chooseMove(g, 'normal', seeded(1)));
    const rng = seeded(3);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(chooseMove(g, 'easy', rng));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]); // two on the board and two that can leave the yard
  });

  it('treats an unknown level like normal', () => {
    const g = rolled(6, { tokens: { red: [10, -1, -1, -1] } });
    expect(chooseMove(g, 'nonsense', seeded(1))).toBe(chooseMove(g, 'normal', seeded(1)));
  });
});

describe.each(['normal', 'hard'])('%s level decisions', (level) => {
  const choose = (g) => chooseMove(g, level, seeded(5));

  it('brings a token home when it can', () => {
    const g = rolled(3, { tokens: { red: [53, 20, 30, -1] } });
    expect(choose(g)).toBe(0);
  });

  it('captures an opponent token when it can', () => {
    const g = rolled(5, { tokens: { red: [10, 30, -1, -1], green: [at('green', 15), -1, -1, -1] } });
    expect(choose(g)).toBe(0);
  });

  it('prefers capturing a token that has travelled further', () => {
    const g = rolled(2, {
      tokens: { red: [10, 20, -1, -1], green: [at('green', 12), at('green', 22), -1, -1] },
    });
    expect(choose(g)).toBe(1);
  });

  it('brings a token out of the yard on a 6 rather than shuffling a token already out', () => {
    const g = rolled(6, { tokens: { red: [10, -1, -1, -1] } });
    expect(choose(g)).not.toBe(0);
  });

  it('prefers a safe cell over an exposed one', () => {
    // Red token 0 reaches the star cell (abs 8); token 1 lands on plain cell 25.
    const g = rolled(2, { tokens: { red: [6, 23, -1, -1] } });
    expect(choose(g)).toBe(0);
  });

  it('avoids landing right in front of an opponent token', () => {
    // Token 1 would land two cells ahead of green; token 0 lands safely on a clear stretch.
    const g = rolled(3, { tokens: { red: [14, 30, -1, -1], green: [at('green', 15), -1, -1, -1] } });
    // red 30+3=33 is clear; red 14+3=17 lands 2 ahead of green at abs 15.
    expect(choose(g)).toBe(1);
  });

  it('moves a threatened token to a safe cell', () => {
    // Green sits 3 behind red token 0 (abs 6); two steps takes it onto the star cell (abs 8).
    const g = rolled(2, { tokens: { red: [6, 40, -1, -1], green: [at('green', 3), -1, -1, -1] } });
    expect(choose(g)).toBe(0);
  });

  it('only ever chooses a legal move, across random positions', () => {
    const rng = seeded(11);
    for (let n = 0; n < 300; n++) {
      const g = new GameState();
      for (const id of g.players) g.tokens[id] = g.tokens[id].map(() => (rng() < 0.3 ? -1 : Math.floor(rng() * 57)));
      g.turn = Math.floor(rng() * 4);
      g.rollDice(rng);
      if (g.phase !== PHASE.MOVE) continue;
      expect(g.legalMoves()).toContain(choose(g));
    }
  });
});

// Plays full games where `levels[color]` decides each colour's moves. Returns the winner.
function playGame(levels, seed, rules) {
  const rng = seeded(seed);
  const players = Object.keys(levels);
  const g = new GameState({ players, rules });
  for (let turns = 0; g.phase !== PHASE.GAME_OVER; turns++) {
    if (turns > 40000) throw new Error(`game did not finish (seed ${seed})`);
    g.rollDice(rng);
    if (g.phase === PHASE.MOVE) g.moveToken(chooseMove(g, levels[g.currentPlayer], rng));
    if (g.phase !== PHASE.GAME_OVER) g.endTurn();
  }
  return g.winner;
}

describe('computer players in full games', () => {
  it('finish every game, at every level, with and without blockades', () => {
    for (const level of LEVELS) {
      for (const rules of [{}, { blockades: true }]) {
        for (let seed = 1; seed <= 8; seed++) {
          const winner = playGame({ red: level, green: level, yellow: level, blue: level }, seed, rules);
          expect(['red', 'green', 'yellow', 'blue']).toContain(winner);
        }
      }
    }
  });

  // Strength: each level should beat the one below clearly. Fixed seeds make this repeatable; the measured
  // rates (over 3000 games) were about: hard vs normal 65%, normal vs easy 83%, hard vs easy 92%.
  const winRate = (strong, weak, games) => {
    let wins = 0;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate seats so neither side benefits from moving first.
      const strongFirst = seed % 2 === 0;
      const levels = strongFirst ? { red: strong, yellow: weak } : { red: weak, yellow: strong };
      if (playGame(levels, seed * 15485863, {}) === (strongFirst ? 'red' : 'yellow')) wins++;
    }
    return wins / games;
  };

  it('normal beats easy clearly', () => {
    expect(winRate('normal', 'easy', 500)).toBeGreaterThan(0.74);
  });

  it('hard beats normal clearly', () => {
    expect(winRate('hard', 'normal', 500)).toBeGreaterThan(0.57);
  });

  it('hard beats easy by a wide margin', () => {
    expect(winRate('hard', 'easy', 500)).toBeGreaterThan(0.85);
  });
});
describe('finishing', () => {
  it('a player controlled entirely by the AI can win', () => {
    const g = makeState({ tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    g.rollDice(rngFor(1));
    g.moveToken(chooseMove(g, 'hard'));
    expect(g.winner).toBe('red');
  });
});


