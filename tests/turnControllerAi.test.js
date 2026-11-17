import { describe, it, expect, vi } from 'vitest';
import { TurnController } from '../src/game/TurnController.js';
import { PHASE } from '../src/game/GameState.js';
import { chooseMove } from '../src/game/ai.js';
import { FakeView, tick } from './fakeView.js';
import { makeState, rngFor, seeded } from './helpers.js';

// A roll source that returns the given dice values in order, then 3s (which never help from the yard).
const dice = (values) => {
  const queue = [...values];
  return () => rngFor(queue.length ? queue.shift() : 3)();
};
const firstLegal = (state) => state.legalMoves()[0];

const setup = ({ computers = ['green', 'yellow', 'blue'], manual = false, choose = firstLegal, rng, ...stateOptions } = {}) => {
  const state = makeState(stateOptions);
  const view = new FakeView({ manual });
  const onError = vi.fn();
  const controller = new TurnController(state, view, { onError, computers, chooseMove: choose, rng });
  return { state, view, controller, onError };
};
// Lets chained computer turns run until the controller is idle again.
const idle = async (controller, rounds = 200) => {
  for (let i = 0; i < rounds; i++) await tick();
  expect(controller.busy).toBe(false);
};
const turns = (view) => view.calls.filter(([n]) => n === 'showTurn').map(([, who, extra]) => `${who}${extra ? '+' : ''}`);

describe('computer players', () => {
  it('require a chooseMove function', () => {
    expect(() => new TurnController(makeState(), new FakeView(), { computers: ['green'] })).toThrow(/chooseMove/);
    expect(() => new TurnController(makeState(), new FakeView())).not.toThrow();
  });

  it('play their turns by themselves and hand back to the person', async () => {
    const { controller, view, state } = setup({ rng: dice([3, 3, 3, 3]) });
    controller.start();
    expect(await controller.requestRoll()).toBe(true); // red rolls a 3: no move, pause, then green, yellow, blue follow on their own
    await idle(controller);
    expect(turns(view)).toEqual(['red', 'green', 'yellow', 'blue', 'red']);
    expect(state.currentPlayer).toBe('red');
    expect(view.rollEnabled).toBe(true);
    expect(controller.isComputer('red')).toBe(false);
    expect(controller.isComputer('green')).toBe(true);
  });

  it('roll, announce their pick, move, and keep the extra turn after a 6', async () => {
    const { controller, view, state } = setup({ turn: 'green', rng: dice([6, 3]) });
    controller.start();
    await idle(controller);
    // green: 6 -> leaves the yard with the first legal token, extra turn -> 3 -> moves it on -> yellow, blue, red
    expect(view.find('showAiPick')).toEqual(['showAiPick', 0]);
    expect(view.find('animateMove')).toEqual(['animateMove', 'green', 0, -1, 0]);
    expect(state.tokens.green[0]).toBe(3); // the extra roll of 3 moved the same token on
    expect(view.count('animateMove')).toBe(2);
    expect(turns(view).slice(0, 3)).toEqual(['green', 'green+', 'yellow']);
    expect(view.names().indexOf('showAiPick')).toBeLessThan(view.names().indexOf('animateMove'));
  });

  it('use the injected chooseMove for the pick', async () => {
    const pick = vi.fn((s) => s.legalMoves().at(-1));
    const { controller, state } = setup({ turn: 'green', choose: pick, rng: dice([6]) });
    controller.start();
    await idle(controller);
    expect(pick).toHaveBeenCalled();
    expect(state.tokens.green).toEqual([-1, -1, -1, 3]); // chose the last token on the 6, then moved it again on the 3
  });

  it('ignore human input during their turn, and the die stays disabled', async () => {
    const { controller, view, state } = setup({ turn: 'green', manual: true, rng: dice([6]) });
    controller.start();
    await tick();
    expect(controller.busy).toBe(true);
    expect(view.rollEnabled).toBe(false);
    expect(await controller.requestRoll()).toBe(false);
    expect(await controller.requestMove(0)).toBe(false);
    expect(state.tokens.green).toEqual([-1, -1, -1, -1]);
    await view.finish(Promise.resolve());
    controller.dispose();
  });

  it('cannot be played for by a person even when no computer turn is running (defence in depth)', async () => {
    // Not started: the input lock is not held, so only the "is this a computer?" check can refuse the click.
    const { controller, state } = setup({ turn: 'green', rng: dice([6]) });
    expect(await controller.requestRoll()).toBe(false);
    expect(state.phase).toBe(PHASE.ROLL);

    const rolled = makeState({ turn: 'green' });
    rolled.rollDice(rngFor(6));
    const other = new TurnController(rolled, new FakeView(), { onError: vi.fn(), computers: ['green'], chooseMove: firstLegal });
    expect(await other.requestMove(0)).toBe(false);
    expect(rolled.tokens.green).toEqual([-1, -1, -1, -1]);
  });

  it('ignore a person who clicks during the pause before the computer moves', async () => {
    const { controller, view } = setup({ turn: 'green', manual: true, rng: dice([6]) });
    controller.start();
    // advance through think pause + roll animation until the pick is announced
    for (let i = 0; i < 20 && !view.find('showAiPick'); i++) { view.flush(); await tick(); }
    expect(view.find('showAiPick')).toBeDefined();
    expect(await controller.requestMove(0)).toBe(false);
    controller.dispose();
  });

  it('resume mid-turn: a computer that had already rolled finishes its move', async () => {
    const state = makeState({ turn: 'green' });
    state.rollDice(rngFor(6));
    const view = new FakeView();
    const controller = new TurnController(state, view, { onError: vi.fn(), computers: ['green', 'yellow', 'blue'], chooseMove: firstLegal, rng: dice([]) });
    controller.start();
    await idle(controller);
    expect(view.find('showRollResult')).toEqual(['showRollResult', 6]);
    expect(view.find('animateMove')).toEqual(['animateMove', 'green', 0, -1, 0]); // finished the move it had rolled for
    expect(state.tokens.green[0]).toBe(3);
  });

  it('stop completely when disposed mid-turn', async () => {
    const { controller, view } = setup({ turn: 'green', manual: true, rng: dice([6]) });
    controller.start();
    await tick();
    controller.dispose();
    const before = view.calls.length;
    for (let i = 0; i < 10; i++) { view.flush(); await tick(); }
    expect(view.calls.length).toBe(before);
  });
});

describe('computer errors', () => {
  it('retries after an error, then hands the seat to a person after three failures', async () => {
    const choose = vi.fn(() => { throw new Error('ai bug'); });
    const { controller, view, state, onError } = setup({ turn: 'green', choose, rng: dice([6]) });
    controller.start();
    await idle(controller);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(controller.isComputer('green')).toBe(false);
    expect(state.phase).toBe(PHASE.MOVE);
    expect(view.movable).toEqual([0, 1, 2, 3]); // a person can now pick a token for green
    expect(await controller.requestMove(2)).toBe(true);
    expect(state.tokens.green[2]).toBe(0);
  });

  it('a single failure is retried and the game carries on', async () => {
    let calls = 0;
    const choose = (s) => { if (calls++ === 0) throw new Error('once'); return s.legalMoves()[0]; };
    const { controller, state, onError } = setup({ turn: 'green', choose, rng: dice([6]) });
    controller.start();
    await idle(controller);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(controller.isComputer('green')).toBe(true);
    expect(state.tokens.green[0]).toBe(3);
  });
});

describe('games played entirely by the AI through the controller', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    it(`run to a winner at the ${level} level, with and without blockades`, async () => {
      for (const [seed, rules] of [[1, {}], [2, { blockades: true }], [3, {}]]) {
        const rng = seeded(seed);
        const state = makeState({ rules });
        const view = new FakeView();
        const onError = vi.fn();
        const controller = new TurnController(state, view, {
          onError, rng, computers: state.players, chooseMove: (s) => chooseMove(s, level, rng),
        });
        controller.start();
        for (let i = 0; i < 30000 && state.phase !== PHASE.GAME_OVER; i++) await tick();
        expect(state.phase, `seed ${seed}`).toBe(PHASE.GAME_OVER);
        expect(onError).not.toHaveBeenCalled();
        // the game went on after the first winner: the 2nd and 3rd place were announced, then the final results once
        expect(view.count('showFinished')).toBe(2);
        expect(view.calls.filter(([n]) => n === 'showFinished').map(([, , position]) => position)).toEqual([1, 2]);
        expect(view.count('showWinner')).toBe(1);
        expect(view.find('showWinner')[1]).toBe(state.winner);
        expect(state.rankings).toHaveLength(4);
      }
    }, 60000);
  }
});

