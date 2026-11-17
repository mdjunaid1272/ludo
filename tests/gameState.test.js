import { describe, it, expect } from 'vitest';
import { GameState, PHASE } from '../src/game/GameState.js';
import { DEFAULT_RULES, resolveRules } from '../src/game/rules.js';
import { SAFE_INDICES, START_INDEX, FINISHED, IN_YARD } from '../src/game/path.js';
import { makeState, play, rngFor, seeded } from './helpers.js';

// Progress of `color` that sits on shared-track cell `abs` (valid for abs reachable on the track).
const at = (color, abs) => (abs - START_INDEX[color] + 52) % 52;
const roll = (g, v) => g.rollDice(rngFor(v));

describe('rules config', () => {
  it('uses documented defaults and is frozen', () => {
    expect(DEFAULT_RULES).toMatchObject({ tripleSix: 'forfeit', blockades: false, sixGrantsExtra: true });
    expect(Object.isFrozen(resolveRules())).toBe(true);
  });

  it('rejects unknown rules and invalid values', () => {
    expect(() => resolveRules({ nope: true })).toThrow(/Unknown rule/);
    expect(() => resolveRules({ tripleSix: 'maybe' })).toThrow(/Invalid value/);
    expect(() => resolveRules({ blockades: 'yes' })).toThrow(/Invalid value/);
  });

  it('rejects invalid player setups', () => {
    expect(() => new GameState({ players: ['red'] })).toThrow();
    expect(() => new GameState({ players: ['red', 'red'] })).toThrow();
    expect(() => new GameState({ players: ['red', 'purple'] })).toThrow();
  });
});

describe('dice rolls', () => {
  it('maps the rng range onto 1..6 and nothing else', () => {
    expect(new GameState().rollDice(() => 0)).toBe(1);
    expect(new GameState().rollDice(() => 0.999999)).toBe(6);
    for (let v = 1; v <= 6; v++) expect(new GameState().rollDice(rngFor(v))).toBe(v);
  });

  it('produces all six values with roughly even frequency from a normal rng', () => {
    const rng = seeded(7);
    const counts = Array(7).fill(0);
    for (let i = 0; i < 6000; i++) counts[1 + Math.floor(rng() * 6)]++;
    for (let v = 1; v <= 6; v++) expect(counts[v]).toBeGreaterThan(850);
  });

  it('stores the roll and refuses a second roll before the turn is finished', () => {
    const g = makeState({ tokens: { red: [5, -1, -1, -1] } });
    expect(roll(g, 3)).toBe(3);
    expect(g.roll).toBe(3);
    expect(() => roll(g, 4)).toThrow(/Cannot roll/);
  });
});

describe('leaving the yard', () => {
  it('only a 6 lets a token out; other rolls end the turn', () => {
    for (let v = 1; v <= 5; v++) {
      const g = new GameState();
      roll(g, v);
      expect(g.phase).toBe(PHASE.END);
      expect(g.legalMoves()).toEqual([]);
      expect(g.endTurn()).toBe(false);
      expect(g.currentPlayer).toBe('green');
    }
  });

  it('a 6 can bring out any of the four yard tokens onto the start cell', () => {
    const g = new GameState();
    roll(g, 6);
    expect(g.phase).toBe(PHASE.MOVE);
    expect(g.legalMoves()).toEqual([0, 1, 2, 3]);
    expect(g.moveToken(2)).toEqual({ from: IN_YARD, to: 0, captured: [], finished: false, position: null });
    expect(g.tokens.red).toEqual([-1, -1, 0, -1]);
  });

  it('lets a token on the board and a yard token both move on a 6', () => {
    const g = makeState({ tokens: { red: [10, -1, -1, -1] } });
    roll(g, 6);
    expect(g.legalMoves()).toEqual([0, 1, 2, 3]);
  });

  it('allows several own tokens on the same start cell', () => {
    const g = makeState({ tokens: { red: [0, -1, -1, -1] } });
    roll(g, 6);
    g.moveToken(1);
    expect(g.tokens.red).toEqual([0, 0, -1, -1]);
  });
});

describe('legal moves and exact home entry', () => {
  it('offers only tokens that can move the rolled distance', () => {
    const g = makeState({ tokens: { red: [10, -1, 55, 56] } });
    roll(g, 1);
    expect(g.legalMoves()).toEqual([0, 2]);
  });

  it('allows landing exactly on the finish from any distance up to 6', () => {
    for (let v = 1; v <= 6; v++) {
      const g = makeState({ tokens: { red: [FINISHED - v, -1, -1, -1] } });
      roll(g, v);
      expect(g.legalMoves()).toContain(0); // on a 6 the yard tokens may also leave
      expect(g.moveToken(0).to).toBe(FINISHED);
    }
  });

  it('forbids overshooting the finish', () => {
    for (const [progress, v] of [[55, 2], [54, 3], [51, 6], [50, 6]]) {
      const g = makeState({ tokens: { red: [progress, -1, -1, -1] } });
      roll(g, v);
      const overshoot = progress + v > FINISHED;
      expect(g.legalMoves().includes(0)).toBe(!overshoot);
    }
    const g = makeState({ tokens: { red: [55, -1, -1, -1] } });
    roll(g, 2);
    expect(g.phase).toBe(PHASE.END);
    expect(() => g.moveToken(0)).toThrow(/Cannot move/);
  });

  it('turns into the home column instead of continuing round the track', () => {
    // Green sits on track cell 51: the cell that follows red's last track cell, which red skips.
    const g = makeState({ tokens: { red: [50, -1, -1, -1], green: [at('green', 51), -1, -1, -1] } });
    roll(g, 1);
    const result = g.moveToken(0);
    expect(result.to).toBe(51);
    expect(result.captured).toEqual([]);
    expect(g.tokens.green[0]).toBe(38);
  });

  it('rejects out-of-range, illegal or non-numeric token indexes', () => {
    const g = makeState({ tokens: { red: [10, -1, -1, -1] } });
    roll(g, 3);
    expect(() => g.moveToken(1)).toThrow(/Illegal move/);
    expect(() => g.moveToken(7)).toThrow(/Illegal move/);
    expect(() => g.moveToken(-1)).toThrow(/Illegal move/);
    expect(() => g.moveToken('0')).toThrow(/Illegal move/);
  });
});

describe('turn phases', () => {
  it('a roll can only be used once', () => {
    const g = makeState({ tokens: { red: [10, 20, -1, -1] } });
    roll(g, 3);
    g.moveToken(0);
    expect(g.phase).toBe(PHASE.END);
    expect(() => g.moveToken(1)).toThrow(/Cannot move/);
    expect(() => roll(g, 3)).toThrow(/Cannot roll/);
    expect(g.legalMoves()).toEqual([]);
  });

  it('endTurn is only valid once the turn has something to end', () => {
    const g = new GameState();
    expect(() => g.endTurn()).toThrow(/Cannot end/);
    roll(g, 6);
    expect(() => g.endTurn()).toThrow(/Cannot end/);
  });

  it('moveToken is rejected before rolling', () => {
    expect(() => new GameState().moveToken(0)).toThrow(/Cannot move/);
  });

  it('passes the turn clockwise and wraps around after the last player', () => {
    const g = new GameState();
    const order = [];
    for (let i = 0; i < 5; i++) {
      order.push(g.currentPlayer);
      roll(g, 1);
      g.endTurn();
    }
    expect(order).toEqual(['red', 'green', 'yellow', 'blue', 'red']);
  });

  it('supports two-player games', () => {
    const g = new GameState({ players: ['red', 'yellow'] });
    roll(g, 2);
    g.endTurn();
    expect(g.currentPlayer).toBe('yellow');
    roll(g, 2);
    g.endTurn();
    expect(g.currentPlayer).toBe('red');
  });
});

describe('captures', () => {
  it('sends a lone opponent token back to the yard and reports it', () => {
    const g = makeState({ tokens: { red: [1, -1, -1, -1], green: [-1, at('green', 3), -1, -1] } });
    roll(g, 2);
    expect(g.moveToken(0).captured).toEqual([{ player: 'green', index: 1 }]);
    expect(g.tokens.green[1]).toBe(IN_YARD);
  });

  it('captures every opponent token stacked on the cell, of any colour', () => {
    const g = makeState({
      tokens: { red: [1, -1, -1, -1], green: [at('green', 3), -1, -1, -1], blue: [at('blue', 3), at('blue', 3), -1, -1] },
    });
    roll(g, 2);
    expect(g.moveToken(0).captured).toHaveLength(3);
    expect(g.tokens.green[0]).toBe(IN_YARD);
    expect(g.tokens.blue.slice(0, 2)).toEqual([IN_YARD, IN_YARD]);
  });

  it('captures on every ordinary (non-safe) track cell a token can reach', () => {
    for (let abs = 2; abs <= 50; abs++) {
      if (SAFE_INDICES.has(abs)) continue;
      const gp = at('green', abs);
      if (gp > 50) continue; // that cell is in green's home column from green's point of view
      const g = makeState({ tokens: { red: [abs - 2, -1, -1, -1], green: [gp, -1, -1, -1] } });
      roll(g, 2);
      expect(g.moveToken(0).captured, `cell ${abs}`).toEqual([{ player: 'green', index: 0 }]);
    }
  });

  it('never captures on a safe cell, and both tokens then share it', () => {
    for (const abs of SAFE_INDICES) {
      if (abs < 2) continue;
      const g = makeState({ tokens: { red: [abs - 2, -1, -1, -1], green: [at('green', abs), -1, -1, -1] } });
      roll(g, 2);
      expect(g.moveToken(0).captured, `safe cell ${abs}`).toEqual([]);
      expect(g.tokens.green[0]).toBe(at('green', abs));
    }
  });

  it('treats a start cell as safe when the owner is on it (leaving the yard)', () => {
    const g = makeState({ tokens: { green: [at('green', 0), -1, -1, -1] } }); // green token on red's start cell
    roll(g, 6);
    expect(g.moveToken(0).captured).toEqual([]);
    expect(g.tokens.green[0]).toBe(39);
  });

  it('does not capture its own tokens', () => {
    const g = makeState({ tokens: { red: [1, 3, -1, -1] } });
    roll(g, 2);
    expect(g.moveToken(0).captured).toEqual([]);
    expect(g.tokens.red.slice(0, 2)).toEqual([3, 3]);
  });

  it('does not capture tokens in the yard, home column or finished', () => {
    const g = makeState({
      tokens: { red: [49, -1, -1, -1], green: [-1, 51, FINISHED, -1], yellow: [-1, 52, 53, -1] },
    });
    roll(g, 3);
    expect(g.moveToken(0).captured).toEqual([]);
    expect(g.tokens.green).toEqual([-1, 51, FINISHED, -1]);
  });

  it('only compares absolute cells, not raw progress numbers', () => {
    // Same progress number 5 for both colours, but different cells: no capture.
    const g = makeState({ tokens: { red: [3, -1, -1, -1], green: [5, -1, -1, -1] } });
    roll(g, 2);
    expect(g.moveToken(0).captured).toEqual([]);
  });
});

describe('extra turns', () => {
  it('a 6 earns another roll for the same player; any other roll passes the turn', () => {
    const g = new GameState();
    roll(g, 6);
    g.moveToken(0);
    expect(g.endTurn()).toBe(true);
    expect(g.currentPlayer).toBe('red');
    expect(g.phase).toBe(PHASE.ROLL);
    play(g, 4, 0);
    g.endTurn();
    expect(g.currentPlayer).toBe('green');
  });

  it('a capture earns another roll, but not when captureGrantsExtra is off', () => {
    for (const [captureGrantsExtra, expected] of [[true, true], [false, false]]) {
      const g = makeState({
        tokens: { red: [1, -1, -1, -1], green: [at('green', 3), -1, -1, -1] },
        rules: { captureGrantsExtra },
      });
      roll(g, 2);
      g.moveToken(0);
      expect(g.endTurn()).toBe(expected);
    }
  });

  it('ends the bonus chain on the next non-6, non-capturing roll', () => {
    const g = makeState({ tokens: { red: [1, -1, -1, -1], green: [at('green', 3), -1, -1, -1] } });
    roll(g, 2);
    g.moveToken(0);
    expect(g.endTurn()).toBe(true);
    roll(g, 2);
    g.moveToken(0);
    expect(g.endTurn()).toBe(false);
    expect(g.currentPlayer).toBe('green');
  });

  it('sixGrantsExtra=false turns the 6 bonus off', () => {
    const g = new GameState({ rules: { sixGrantsExtra: false } });
    roll(g, 6);
    g.moveToken(0);
    expect(g.endTurn()).toBe(false);
  });

  it('a 6 that cannot be played still earns a roll by default, and not with sixWithoutMoveGrantsExtra=false', () => {
    for (const [flag, expected] of [[true, true], [false, false]]) {
      const g = makeState({ tokens: { red: [55, 55, 55, 55] }, rules: { sixWithoutMoveGrantsExtra: flag } });
      roll(g, 6);
      expect(g.phase).toBe(PHASE.END);
      expect(g.endTurn()).toBe(expected);
    }
  });

  it('by default, bringing a token home earns another roll (the classic house rule)', () => {
    const g = makeState({ tokens: { red: [54, -1, -1, -1] } });
    roll(g, 2);
    expect(g.moveToken(0).finished).toBe(true);
    expect(g.endTurn()).toBe(true);
    expect(g.currentPlayer).toBe('red');
  });

  it('finishing a token earns a roll only when finishGrantsExtra is on', () => {
    for (const [flag, expected] of [[false, false], [true, true]]) {
      const g = makeState({ tokens: { red: [54, -1, -1, -1] }, rules: { finishGrantsExtra: flag } });
      roll(g, 2);
      expect(g.moveToken(0).finished).toBe(true);
      expect(g.endTurn()).toBe(expected);
    }
  });
});

describe('triple six', () => {
  const sixes = (g, n) => {
    for (let i = 0; i < n; i++) {
      play(g, 6, g.tokens.red.indexOf(IN_YARD) >= 0 ? g.tokens.red.indexOf(IN_YARD) : 0);
      expect(g.endTurn()).toBe(true);
    }
  };

  it('forfeits the third consecutive 6: no move, turn passes', () => {
    const g = new GameState();
    sixes(g, 2);
    roll(g, 6);
    expect(g.forfeited).toBe(true);
    expect(g.phase).toBe(PHASE.END);
    expect(g.legalMoves()).toEqual([]);
    expect(g.tokens.red.filter((p) => p === 0)).toHaveLength(2);
    expect(g.endTurn()).toBe(false);
    expect(g.currentPlayer).toBe('green');
    expect(g.sixesInRow).toBe(0);
  });

  it('lets the next player roll sixes normally afterwards', () => {
    const g = new GameState();
    sixes(g, 2);
    roll(g, 6);
    g.endTurn();
    roll(g, 6);
    expect(g.forfeited).toBe(false);
    expect(g.phase).toBe(PHASE.MOVE);
  });

  it('resets the counter on any non-6 roll in a capture chain', () => {
    const g = makeState({ tokens: { red: [1, 2, -1, -1], green: [at('green', 3), at('green', 5), -1, -1] } });
    roll(g, 6);
    g.moveToken(2);
    g.endTurn();
    expect(g.sixesInRow).toBe(1);
    roll(g, 2);
    expect(g.sixesInRow).toBe(0);
    g.moveToken(0); // captures green at cell 3
    expect(g.endTurn()).toBe(true);
    roll(g, 6);
    g.moveToken(3);
    g.endTurn();
    roll(g, 6);
    expect(g.forfeited).toBe(false);
  });

  it("is off when tripleSix is 'off'", () => {
    const g = new GameState({ rules: { tripleSix: 'off' } });
    sixes(g, 3);
    roll(g, 6);
    expect(g.forfeited).toBe(false);
  });

  it('a forfeited 6 does not give an extra roll even with sixGrantsExtra', () => {
    const g = new GameState();
    sixes(g, 2);
    roll(g, 6);
    expect(g.endTurn()).toBe(false);
  });
});

describe('finished tokens and winning', () => {
  it('finished tokens never move again', () => {
    const g = makeState({ tokens: { red: [FINISHED, FINISHED, 10, -1] } });
    for (let v = 1; v <= 6; v++) {
      const probe = makeState({ tokens: { red: [FINISHED, FINISHED, 10, -1] } });
      roll(probe, v);
      expect(probe.legalMoves()).not.toContain(0);
      expect(probe.legalMoves()).not.toContain(1);
    }
    expect(g.tokens.red[0]).toBe(FINISHED);
  });

  it('does not end the game until all four tokens are home', () => {
    const g = makeState({ tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    roll(g, 1);
    g.moveToken(3);
    expect(g.winner).toBe('red');
    const partial = makeState({ tokens: { red: [FINISHED, FINISHED, 54, 55] } });
    roll(partial, 1);
    partial.moveToken(3);
    expect(partial.winner).toBeNull();
    expect(partial.phase).toBe(PHASE.END);
  });

  it('stops the game when only one player is left: no more rolls, moves or turns', () => {
    const g = makeState({ players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    roll(g, 1);
    g.moveToken(3);
    expect(g.phase).toBe(PHASE.GAME_OVER);
    expect(() => roll(g, 1)).toThrow(/Cannot roll/);
    expect(() => g.moveToken(0)).toThrow(/Cannot move/);
    expect(() => g.endTurn()).toThrow(/Cannot end/);
    expect(g.currentPlayer).toBe('red');
    expect(g.legalMoves()).toEqual([]);
  });

  it('can be won by any colour', () => {
    for (const color of ['green', 'yellow', 'blue']) {
      const g = makeState({ turn: color, tokens: { [color]: [FINISHED, FINISHED, FINISHED, 55] } });
      roll(g, 1);
      g.moveToken(3);
      expect(g.winner).toBe(color);
    }
  });
});

// Finishing and positions: the first to get all four tokens home is 1st and stops playing; the others carry on until only
// one is left, who takes the last position.
describe('finishing and rankings', () => {
  const HOME = [FINISHED, FINISHED, FINISHED, 55];
  // red is about to finish (needs a 1); the others hold whatever `tokens` says
  const finishing = (players, tokens = {}, extra = {}) => makeState({ players, tokens: { red: HOME, ...tokens }, ...extra });
  const finishNow = (g) => { roll(g, 1); return g.moveToken(3); };

  it('gives the first player to finish 1st place and goes on with the others (4 players)', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue']);
    const result = finishNow(g);
    expect(result.position).toBe(1);
    expect(g.rankings).toEqual(['red']);
    expect(g.winner).toBe('red');
    expect(g.phase).toBe(PHASE.END); // not over
    expect(g.statusOf('red')).toBe('finished');
    expect(g.statusOf('green')).toBe('playing');
    expect(g.positionOf('red')).toBe(1);
    expect(g.positionOf('green')).toBeNull();
    expect(g.activePlayers).toEqual(['green', 'yellow', 'blue']);
  });

  it('does not touch the other players\' tokens when somebody finishes', () => {
    const others = { green: [3, 20, -1, FINISHED], yellow: [-1, -1, -1, -1], blue: [40, 41, 42, 43] };
    const g = finishing(['red', 'green', 'yellow', 'blue'], others);
    finishNow(g);
    for (const [color, list] of Object.entries(others)) expect(g.tokens[color]).toEqual(list);
  });

  it('gives a player who has just finished no bonus roll, even for a 6 or a finish, and passes the turn on', () => {
    for (const rules of [{ finishGrantsExtra: true, sixGrantsExtra: true }, { finishGrantsExtra: true }]) {
      const g = finishing(['red', 'green', 'yellow', 'blue'], {}, { rules });
      g.tokens.red = [FINISHED, FINISHED, FINISHED, 50]; // a 6 finishes it too
      roll(g, 6);
      const result = g.moveToken(3);
      expect(result.position).toBe(1);
      expect(g.endTurn()).toBe(false);
      expect(g.currentPlayer).toBe('green');
    }
  });

  it('skips finished players in the turn order, so nobody who is out ever rolls again', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue']);
    finishNow(g);
    g.endTurn(); // -> green
    const order = [];
    for (let i = 0; i < 7; i++) {
      order.push(g.currentPlayer);
      roll(g, 3); // nothing in the yard moves on a 3
      g.endTurn();
    }
    expect(order).toEqual(['green', 'yellow', 'blue', 'green', 'yellow', 'blue', 'green']);
    expect(order).not.toContain('red');
  });

  it('follows the order of the examples: after red finishes, blue then green then yellow; after blue, green then yellow', () => {
    const g = makeState({ players: ['red', 'blue', 'green', 'yellow'], tokens: { red: HOME } });
    finishNow(g);
    g.endTurn();
    expect(g.currentPlayer).toBe('blue');
    g.tokens.blue = [...HOME];
    roll(g, 1);
    expect(g.moveToken(3).position).toBe(2);
    g.endTurn();
    expect(g.currentPlayer).toBe('green');
    roll(g, 2); g.endTurn();
    expect(g.currentPlayer).toBe('yellow');
    roll(g, 2); g.endTurn();
    expect(g.currentPlayer).toBe('green'); // blue and red are out
  });

  it('lets the next two finish as 2nd and 3rd, and the last player left automatically takes 4th', () => {
    const g = makeState({ players: ['red', 'green', 'yellow', 'blue'], tokens: { red: HOME } });
    expect(finishNow(g).position).toBe(1);
    g.endTurn();
    g.tokens.green = [...HOME];
    roll(g, 1);
    expect(g.moveToken(3).position).toBe(2);
    expect(g.phase).toBe(PHASE.END);
    g.endTurn();
    expect(g.currentPlayer).toBe('yellow');
    g.tokens.yellow = [...HOME];
    roll(g, 1);
    const last = g.moveToken(3);
    expect(last.position).toBe(3);
    expect(g.phase).toBe(PHASE.GAME_OVER); // only blue is left
    expect(g.rankings).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(g.positionOf('blue')).toBe(4);
    expect(g.winner).toBe('red');
    expect(g.statusOf('blue')).toBe('finished'); // decided
    expect(() => roll(g, 1)).toThrow(/Cannot roll/);
    expect(() => g.endTurn()).toThrow(/Cannot end/);
  });

  it('ends a 2-player game at the first finish: the other player is 2nd', () => {
    const g = finishing(['red', 'green']);
    expect(finishNow(g).position).toBe(1);
    expect(g.phase).toBe(PHASE.GAME_OVER);
    expect(g.rankings).toEqual(['red', 'green']);
  });

  it('ends a 3-player game after the second finish', () => {
    const g = makeState({ players: ['red', 'green', 'yellow'], tokens: { red: HOME } });
    expect(finishNow(g).position).toBe(1);
    expect(g.phase).toBe(PHASE.END);
    g.endTurn();
    g.tokens.green = [...HOME];
    expect(g.currentPlayer).toBe('green');
    roll(g, 1);
    expect(g.moveToken(3).position).toBe(2);
    expect(g.phase).toBe(PHASE.GAME_OVER);
    expect(g.rankings).toEqual(['red', 'green', 'yellow']);
  });

  it('never lets a finished player roll or move (their tokens are all home anyway)', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue']);
    finishNow(g);
    g.endTurn();
    expect(g.currentPlayer).not.toBe('red');
    // even if a buggy caller made red the current player, there would be nothing legal for them
    g.turn = 0;
    roll(g, 6);
    expect(g.legalMoves()).toEqual([]);
  });

  it('keeps the dice and extra-turn rules for the players still in: a 6 and a capture still give another roll', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue'], { green: [10, -1, -1, -1] });
    finishNow(g);
    g.endTurn(); // green
    roll(g, 6);
    g.moveToken(0);
    expect(g.endTurn()).toBe(true); // a 6: green rolls again
    expect(g.currentPlayer).toBe('green');
  });

  it('applies the third-six rule to the players still in', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue'], { green: [10, 11, -1, -1] });
    finishNow(g);
    g.endTurn();
    for (let i = 0; i < 2; i++) { roll(g, 6); g.moveToken(0); expect(g.endTurn()).toBe(true); }
    roll(g, 6);
    expect(g.forfeited).toBe(true);
    expect(g.endTurn()).toBe(false);
    expect(g.currentPlayer).toBe('yellow');
  });

  it('survives snapshots in the middle of it all, rejecting inconsistent ones', () => {
    const g = finishing(['red', 'green', 'yellow', 'blue']);
    finishNow(g);
    const snap = g.snapshot();
    expect(snap.rankings).toEqual(['red']);
    const copy = GameState.fromSnapshot(snap);
    expect(copy.rankings).toEqual(['red']);
    expect(copy.winner).toBe('red');
    expect(copy.snapshot()).toEqual(snap);
    for (const bad of [
      { ...snap, rankings: ['red', 'red'] },
      { ...snap, rankings: ['purple'] },
      { ...snap, rankings: ['green'] }, // green has not finished
      { ...snap, rankings: [] }, // the winner must be first in the rankings
      { ...snap, rankings: ['red', 'green', 'yellow', 'blue'] }, // all ranked but the game is not over
      { ...snap, phase: PHASE.GAME_OVER }, // over, but one rank only
    ]) expect(() => GameState.fromSnapshot(bad), JSON.stringify(bad.rankings)).toThrow(/Invalid snapshot/);
    expect(() => GameState.fromSnapshot({ ...snap, turn: 0, phase: PHASE.ROLL })).toThrow(/player who is out/);
  });

  it('finishes games between four random players with every position handed out once, in the order they finished', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = new GameState({ rules: { finishGrantsExtra: seed % 2 === 0 } });
      const rng = seeded(seed);
      const order = [];
      for (let steps = 0; steps < 20000 && g.phase !== PHASE.GAME_OVER; steps++) {
        if (g.phase === PHASE.ROLL) { g.rollDice(rng); continue; }
        if (g.phase === PHASE.MOVE) {
          const moves = g.legalMoves();
          const player = g.currentPlayer;
          const r = g.moveToken(moves[Math.floor(rng() * moves.length)]);
          if (r.position) order.push([player, r.position]);
          continue;
        }
        const wasOut = g.rankings.includes(g.currentPlayer);
        g.endTurn();
        expect(wasOut ? true : !g.rankings.includes(g.currentPlayer)).toBe(true);
        expect(g.rankings.includes(g.currentPlayer)).toBe(false); // never a finished player's turn
      }
      expect(g.phase, `seed ${seed}`).toBe(PHASE.GAME_OVER);
      expect([...g.rankings].sort()).toEqual([...g.players].sort());
      expect(order.map(([, p]) => p)).toEqual(order.map((_, i) => i + 1));
      expect(order.map(([c]) => c)).toEqual(g.rankings.slice(0, order.length));
      expect(g.winner).toBe(g.rankings[0]);
    }
  });
});

describe('blockades', () => {
  const on = { blockades: true };
  // Green pair on shared cell `abs`.
  const pairAt = (abs) => [at('green', abs), at('green', abs), -1, -1];

  it('are ignored by default: opponents pass through and capture a pair', () => {
    const g = makeState({ tokens: { red: [3, -1, -1, -1], green: pairAt(5) } });
    roll(g, 3);
    expect(g.legalMoves()).toContain(0);
    const g2 = makeState({ tokens: { red: [3, -1, -1, -1], green: pairAt(5) } });
    roll(g2, 2);
    expect(g2.moveToken(0).captured).toHaveLength(2);
  });

  it('block opponents from landing on the pair or passing it', () => {
    const rollOf = (v) => {
      const g = makeState({ tokens: { red: [3, -1, -1, -1], green: pairAt(5) }, rules: on });
      roll(g, v);
      return g.legalMoves();
    };
    expect(rollOf(1)).toEqual([0]); // stops on cell 4, before the pair
    expect(rollOf(2)).toEqual([]); // would land on the pair
    expect(rollOf(3)).toEqual([]); // would pass the pair
  });

  it('are not formed by a single token, and never block the owner', () => {
    const single = makeState({ tokens: { red: [3, -1, -1, -1], green: [at('green', 5), -1, -1, -1] }, rules: on });
    roll(single, 3);
    expect(single.legalMoves()).toEqual([0]);

    const own = makeState({ turn: 'green', tokens: { green: [at('green', 4), ...pairAt(6).slice(0, 2), -1] }, rules: on });
    roll(own, 3);
    expect(own.legalMoves()).toContain(0);
  });

  it('are not formed by two tokens of different colours', () => {
    const g = makeState({
      tokens: { red: [3, -1, -1, -1], green: [at('green', 5), -1, -1, -1], blue: [at('blue', 5), -1, -1, -1] },
      rules: on,
    });
    roll(g, 3);
    expect(g.legalMoves()).toEqual([0]);
  });

  it('also apply on safe cells', () => {
    const g = makeState({ tokens: { red: [6, -1, -1, -1], green: pairAt(8) }, rules: on });
    roll(g, 2);
    expect(g.legalMoves()).toEqual([]);
  });

  it('do not stop a colour leaving the yard when they are off (the default)', () => {
    const g = makeState({ tokens: { green: [39, 39, -1, -1] } });
    roll(g, 6);
    expect(g.phase).toBe(PHASE.MOVE);
    expect(g.legalMoves()).toEqual([0, 1, 2, 3].filter((i) => g.tokens.red[i] === -1));
  });

  it('stop a colour leaving the yard when a pair sits on its start cell', () => {
    const g = makeState({ tokens: { green: [39, 39, -1, -1] }, rules: on });
    roll(g, 6);
    expect(g.phase).toBe(PHASE.END);
    expect(g.legalMoves()).toEqual([]);
  });

  it('do not affect the home column', () => {
    const g = makeState({ tokens: { red: [49, -1, -1, -1], green: pairAt(51) }, rules: on });
    roll(g, 4);
    expect(g.legalMoves()).toEqual([0]);
    expect(g.moveToken(0).to).toBe(53);
  });

  it('lift as soon as the pair is broken', () => {
    const g = makeState({ tokens: { red: [3, -1, -1, -1], green: pairAt(5) }, rules: on });
    g.tokens.green[1] = at('green', 20);
    roll(g, 3);
    expect(g.legalMoves()).toEqual([0]);
  });

  it('still allow capturing a single token', () => {
    const g = makeState({ tokens: { red: [3, -1, -1, -1], green: [at('green', 5), -1, -1, -1] }, rules: on });
    roll(g, 2);
    expect(g.moveToken(0).captured).toHaveLength(1);
  });
});

describe('a player leaving the running game', () => {
  it('takes them out completely: tokens off the board, no turns, status left', () => {
    const g = makeState({ tokens: { green: [3, 20, -1, FINISHED], yellow: [-1, -1, -1, -1] } });
    expect(g.removePlayer('green')).toBe(true);
    expect(g.statusOf('green')).toBe('left');
    expect(g.isOut('green')).toBe(true);
    expect(g.tokens.green).toEqual([-1, -1, -1, -1]);
    expect(g.activePlayers).toEqual(['red', 'yellow', 'blue']);
    expect(g.phase).toBe(PHASE.ROLL); // not their turn: nothing else changes
    expect(g.currentPlayer).toBe('red');
    const order = [];
    for (let i = 0; i < 5; i++) { order.push(g.currentPlayer); roll(g, 3); g.endTurn(); }
    expect(order).toEqual(['red', 'yellow', 'blue', 'red', 'yellow']);
  });

  it('ends their turn when they leave in the middle of it, without a bonus roll', () => {
    const g = makeState({ tokens: { red: [10, -1, -1, -1] } });
    roll(g, 6); // red rolled a 6: a bonus roll would follow
    expect(g.removePlayer('red')).toBe(true);
    expect(g.phase).toBe(PHASE.END);
    expect(g.endTurn()).toBe(false);
    expect(g.currentPlayer).toBe('green');
    expect(g.sixesInRow).toBe(0);
  });

  it('does nothing for a player who is not in the game, who has finished, who already left, or when the game is over', () => {
    const g = makeState({ players: ['red', 'green', 'yellow'], tokens: { red: [56, 56, 56, 55] } });
    expect(g.removePlayer('blue')).toBe(false);
    roll(g, 1);
    g.moveToken(3); // red finishes (1st)
    expect(g.removePlayer('red')).toBe(false);
    expect(g.removePlayer('green')).toBe(true); // green leaves: yellow is alone, the game is over
    expect(g.removePlayer('green')).toBe(false);
    expect(g.phase).toBe(PHASE.GAME_OVER);
    expect(g.removePlayer('yellow')).toBe(false);
    expect(g.rankings).toEqual(['red', 'yellow', 'green']);
  });

  it('gives the win to the player who is left alone, and ranks the leavers last (the latest to leave first)', () => {
    const g = makeState({ players: ['red', 'green', 'yellow', 'blue'] });
    g.removePlayer('green');
    g.removePlayer('blue');
    expect(g.phase).toBe(PHASE.ROLL);
    g.removePlayer('red');
    expect(g.phase).toBe(PHASE.GAME_OVER);
    expect(g.winner).toBe('yellow');
    expect(g.rankings).toEqual(['yellow', 'red', 'blue', 'green']);
  });

  it('puts the leavers after those who finished and the one who stayed, when the game ends by finishing', () => {
    const g = makeState({ players: ['red', 'green', 'yellow'], tokens: { red: [56, 56, 56, 55] } });
    g.removePlayer('green');
    roll(g, 1);
    const r = g.moveToken(3);
    expect(r.position).toBe(1);
    expect(g.phase).toBe(PHASE.GAME_OVER); // only yellow is left
    expect(g.rankings).toEqual(['red', 'yellow', 'green']);
  });

  it('survives snapshots, and refuses inconsistent ones', () => {
    const g = makeState({});
    g.removePlayer('blue');
    const snap = g.snapshot();
    expect(snap.left).toEqual(['blue']);
    expect(GameState.fromSnapshot(snap).snapshot()).toEqual(snap);
    expect(() => GameState.fromSnapshot({ ...snap, left: ['blue', 'blue'] })).toThrow(/Invalid snapshot/);
    expect(() => GameState.fromSnapshot({ ...snap, left: ['purple'] })).toThrow(/Invalid snapshot/);
    expect(() => GameState.fromSnapshot({ ...snap, turn: 3 })).toThrow(/player who is out/); // blue's turn
  });
});
