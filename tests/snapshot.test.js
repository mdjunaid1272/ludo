import { describe, it, expect } from 'vitest';
import { GameState, PHASE } from '../src/game/GameState.js';
import { chooseMove } from '../src/game/ai.js';
import { FINISHED } from '../src/game/path.js';
import { makeState, rngFor, seeded } from './helpers.js';

describe('GameState snapshots', () => {
  it('survive JSON (what is sent over the network) unchanged', () => {
    const g = makeState({ tokens: { red: [3, -1, 55, 56], green: [10, 20, -1, -1] } });
    g.rollDice(rngFor(4));
    const copy = GameState.fromSnapshot(JSON.parse(JSON.stringify(g.snapshot())));
    expect(copy.snapshot()).toEqual(g.snapshot());
    expect(copy.currentPlayer).toBe(g.currentPlayer);
    expect(copy.legalMoves()).toEqual(g.legalMoves());
  });

  it('round-trip in every phase, including after a win', () => {
    const roll = makeState();
    const move = makeState();
    move.rollDice(rngFor(6));
    const end = makeState();
    end.rollDice(rngFor(3));
    const over = makeState({ players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    over.rollDice(rngFor(1));
    over.moveToken(3);
    expect([roll.phase, move.phase, end.phase, over.phase]).toEqual([PHASE.ROLL, PHASE.MOVE, PHASE.END, PHASE.GAME_OVER]);
    for (const g of [roll, move, end, over]) {
      expect(GameState.fromSnapshot(g.snapshot()).snapshot()).toEqual(g.snapshot());
    }
  });

  it('do not share arrays with the original', () => {
    const g = makeState();
    const snap = g.snapshot();
    snap.tokens.red[0] = 30;
    expect(g.tokens.red[0]).toBe(-1);
    const copy = GameState.fromSnapshot(g.snapshot());
    copy.tokens.red[1] = 5;
    expect(g.tokens.red[1]).toBe(-1);
  });

  it('keep the rules and the triple-six counter', () => {
    const g = makeState({ rules: { blockades: true, tripleSix: 'off' }, players: ['red', 'yellow'] });
    g.sixesInRow = 2;
    const copy = GameState.fromSnapshot(g.snapshot());
    expect(copy.rules.blockades).toBe(true);
    expect(copy.rules.tripleSix).toBe('off');
    expect(copy.players).toEqual(['red', 'yellow']);
    expect(copy.sixesInRow).toBe(2);
  });

  it('a restored copy behaves identically to the original from any point (lockstep over random games)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = seeded(seed);
      const rules = seed % 3 === 0 ? { blockades: true } : {};
      const original = new GameState({ rules });
      let mirror = GameState.fromSnapshot(original.snapshot());
      for (let step = 0; step < 4000 && original.phase !== PHASE.GAME_OVER; step++) {
        const value = 1 + Math.floor(rng() * 6);
        original.rollDice(rngFor(value));
        mirror.rollDice(rngFor(value));
        expect(mirror.snapshot()).toEqual(original.snapshot());
        if (original.phase === PHASE.MOVE) {
          const index = chooseMove(original, 'normal', rng);
          const a = original.moveToken(index);
          const b = mirror.moveToken(index);
          expect(b).toEqual(a);
        }
        if (original.phase !== PHASE.GAME_OVER) {
          expect(mirror.endTurn()).toBe(original.endTurn());
        }
        // Re-create the mirror from a snapshot every few steps, as a reconnecting client would.
        if (step % 7 === 0) mirror = GameState.fromSnapshot(JSON.parse(JSON.stringify(original.snapshot())));
        expect(mirror.snapshot()).toEqual(original.snapshot());
      }
      expect(original.phase).toBe(PHASE.GAME_OVER);
    }
  });
});

describe('restoring untrusted snapshots', () => {
  const good = () => makeState({ tokens: { red: [3, -1, -1, -1] } }).snapshot();
  const mutate = (change) => {
    const s = good();
    change(s);
    return s;
  };

  it('rejects malformed data without changing the game', () => {
    const bad = {
      'not an object': null,
      'missing tokens': mutate((s) => delete s.tokens),
      'token list too short': mutate((s) => (s.tokens.red = [1, 2, 3])),
      'token out of range (high)': mutate((s) => (s.tokens.red[0] = 57)),
      'token out of range (low)': mutate((s) => (s.tokens.red[0] = -2)),
      'token not an integer': mutate((s) => (s.tokens.red[0] = 1.5)),
      'token is a string': mutate((s) => (s.tokens.red[0] = '3')),
      'turn out of range': mutate((s) => (s.turn = 9)),
      'turn is negative': mutate((s) => (s.turn = -1)),
      'unknown phase': mutate((s) => (s.phase = 'cheating')),
      'roll out of range': mutate((s) => (s.roll = 7)),
      'roll is a string': mutate((s) => (s.roll = '6')),
      'unknown winner': mutate((s) => (s.winner = 'purple')),
      'too many sixes': mutate((s) => (s.sixesInRow = 4)),
      'different players': mutate((s) => (s.players = ['red', 'green'])),
    };
    for (const [name, snapshot] of Object.entries(bad)) {
      const g = makeState();
      const before = JSON.stringify(g.snapshot());
      expect(() => g.restore(snapshot), name).toThrow(/Invalid snapshot/);
      expect(JSON.stringify(g.snapshot()), `${name} must not change the game`).toBe(before);
    }
  });

  it('fromSnapshot rejects impossible player lists and rules', () => {
    expect(() => GameState.fromSnapshot(null)).toThrow();
    expect(() => GameState.fromSnapshot(mutate((s) => (s.players = ['red'])))).toThrow();
    expect(() => GameState.fromSnapshot(mutate((s) => (s.players = ['red', 'red'])))).toThrow();
    expect(() => GameState.fromSnapshot(mutate((s) => (s.rules = { bogus: true })))).toThrow();
  });
});
