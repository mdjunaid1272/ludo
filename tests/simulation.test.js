import assert from 'node:assert/strict';
import { describe, it, expect } from 'vitest';
import { GameState, PHASE } from '../src/game/GameState.js';
import { FINISHED, IN_YARD, absIndexFor } from '../src/game/path.js';
import { seeded } from './helpers.js';

const RULE_SETS = {
  default: {},
  'blockades on': { blockades: true },
  'no limits': { tripleSix: 'off', sixWithoutMoveGrantsExtra: false },
  'all bonuses': { finishGrantsExtra: true, blockades: true },
};

// Plays a whole game with a random legal move each turn, checking invariants as it goes.
function playRandomGame(seed, rules, players) {
  const rng = seeded(seed);
  const g = new GameState({ rules, players });
  let turns = 0;
  while (g.phase !== PHASE.GAME_OVER) {
    if (++turns > 40000) throw new Error(`game did not finish (seed ${seed})`);
    g.rollDice(rng);
    const moves = g.legalMoves();
    assert.equal(g.phase, moves.length ? PHASE.MOVE : PHASE.END);
    if (moves.length) {
      const index = moves[Math.floor(rng() * moves.length)];
      if (rules.blockades) expectNoBlockadeCrossed(g, index);
      const result = g.moveToken(index);
      assert.ok(result.to >= 0 && result.to <= FINISHED, 'token left the valid range');
      checkInvariants(g);
    }
    if (g.phase !== PHASE.GAME_OVER) g.endTurn();
  }
  return g;
}

// With blockades on, a legal move must never land on or pass an opponent pair.
function expectNoBlockadeCrossed(g, index) {
  const me = g.currentPlayer;
  const from = g.tokens[me][index];
  const to = from === IN_YARD ? 0 : from + g.roll;
  for (let step = from + 1; step <= Math.min(to, 50); step++) {
    const abs = absIndexFor(me, step);
    for (const other of g.players) {
      if (other === me) continue;
      const count = g.tokens[other].filter((p) => absIndexFor(other, p) === abs).length;
      assert.ok(count < 2, `${me} crossed a ${other} blockade at cell ${abs}`);
    }
  }
}

function checkInvariants(g) {
  for (const id of g.players) {
    assert.equal(g.tokens[id].length, 4);
    for (const p of g.tokens[id]) assert.ok(Number.isInteger(p) && p >= IN_YARD && p <= FINISHED, 'invalid progress ' + p);
  }
}

describe('random full-game simulations', () => {
  for (const [name, rules] of Object.entries(RULE_SETS)) {
    it(`play on after the first winner until every position is decided (${name})`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const g = playRandomGame(seed, rules);
        expect(g.winner).not.toBeNull();
        expect(g.winner).toBe(g.rankings[0]);
        expect(g.tokens[g.winner].every((p) => p === FINISHED)).toBe(true);
        // every seat has exactly one position; all but the last place got all tokens home
        expect([...g.rankings].sort()).toEqual([...g.players].sort());
        const home = (id) => g.tokens[id].every((p) => p === FINISHED);
        expect(g.rankings.slice(0, -1).every(home)).toBe(true);
        expect(home(g.rankings.at(-1))).toBe(false);
      }
    });
  }

  it('also works with two and three players', () => {
    for (const players of [['red', 'yellow'], ['green', 'yellow', 'blue']]) {
      const g = playRandomGame(99, {}, players);
      expect(players).toContain(g.winner);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = playRandomGame(5, {});
    const b = playRandomGame(5, {});
    expect(a.winner).toBe(b.winner);
    expect(a.tokens).toEqual(b.tokens);
  });
});



