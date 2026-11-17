import { describe, it, expect, vi } from 'vitest';
import { TurnController } from '../src/game/TurnController.js';
import { PHASE } from '../src/game/GameState.js';
import { Cancelled } from '../src/game/Cancelled.js';
import { FINISHED, START_INDEX } from '../src/game/path.js';
import { FakeView, tick } from './fakeView.js';
import { makeState, rngFor } from './helpers.js';

const setup = ({ manual = false, ...stateOptions } = {}) => {
  const state = makeState(stateOptions);
  const view = new FakeView({ manual });
  const onError = vi.fn();
  const controller = new TurnController(state, view, { onError });
  controller.start();
  return { state, view, controller, onError };
};
const roll = (controller, value) => {
  controller.rng = rngFor(value);
  return controller.requestRoll();
};

describe('TurnController flow', () => {
  it('starts by announcing the first turn and enabling the die', () => {
    const { view } = setup();
    expect(view.find('showTurn')).toEqual(['showTurn', 'red', false]);
    expect(view.rollEnabled).toBe(true);
  });

  it('plays a 6: roll, pick, move, then an extra turn for the same player', async () => {
    const { state, view, controller } = setup();
    expect(await roll(controller, 6)).toBe(true);
    expect(view.find('animateRoll')).toEqual(['animateRoll', 6]);
    expect(view.movable).toEqual([0, 1, 2, 3]);
    expect(view.rollEnabled).toBe(false);

    expect(await controller.requestMove(2)).toBe(true);
    expect(state.tokens.red).toEqual([-1, -1, 0, -1]);
    expect(view.find('animateMove')).toEqual(['animateMove', 'red', 2, -1, 0]);
    expect(view.names().slice(-3)).toEqual(['settle', 'showTurn', 'setRollEnabled']);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'red', true]);
    expect(state.phase).toBe(PHASE.ROLL);
  });

  it('passes the turn after a normal move', async () => {
    const { view, controller } = setup({ tokens: { red: [10, -1, -1, -1] } });
    await roll(controller, 3);
    await controller.requestMove(0);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
  });

  it('with no legal move, reports it, pauses, and passes the turn', async () => {
    const { view, controller } = setup();
    expect(await roll(controller, 3)).toBe(true);
    expect(view.find('showNoMoves')).toEqual(['showNoMoves', 'red', 3, false]);
    expect(view.find('pause')).toEqual(['pause', 900]);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
    expect(view.rollEnabled).toBe(true);
  });

  it('reports a forfeited third six', async () => {
    const { state, view, controller } = setup();
    state.sixesInRow = 2;
    await roll(controller, 6);
    expect(view.find('showNoMoves')).toEqual(['showNoMoves', 'red', 6, true]);
  });

  it('shows captures between the move and the settle', async () => {
    const green = (START_INDEX.red + 3 - START_INDEX.green + 52) % 52;
    const { state, view, controller } = setup({ tokens: { red: [1, -1, -1, -1], green: [green, -1, -1, -1] } });
    await roll(controller, 2);
    await controller.requestMove(0);
    const order = view.names().filter((n) => ['animateMove', 'announceCapture', 'animateCaptures', 'settle'].includes(n));
    expect(order).toEqual(['animateMove', 'announceCapture', 'animateCaptures', 'settle']);
    expect(view.find('announceCapture')[2]).toEqual([{ player: 'green', index: 0 }]);
    expect(state.tokens.green[0]).toBe(-1);
  });

  it('announces the winner and then ignores all input', async () => {
    const { state, view, controller } = setup({ players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    await roll(controller, 1);
    await controller.requestMove(3);
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(state.phase).toBe(PHASE.GAME_OVER);
    expect(await roll(controller, 1)).toBe(false);
    expect(await controller.requestMove(0)).toBe(false);
  });
});

describe('input protection', () => {
  it('ignores a second roll click while the first is still animating', async () => {
    const { state, view, controller } = setup({ manual: true });
    controller.rng = rngFor(6);
    const first = controller.requestRoll();
    expect(controller.busy).toBe(true);
    expect(await controller.requestRoll()).toBe(false);
    expect(view.count('animateRoll')).toBe(1);
    expect(state.roll).toBe(6);

    view.flush();
    expect(await first).toBe(true);
    expect(controller.busy).toBe(false);
  });

  it('ignores token clicks while the roll animation is running', async () => {
    const { state, view, controller } = setup({ manual: true });
    controller.rng = rngFor(6);
    const rolling = controller.requestRoll();
    expect(await controller.requestMove(0)).toBe(false);
    view.flush();
    await rolling;
    expect(state.tokens.red).toEqual([-1, -1, -1, -1]);
  });

  it('moves a token once even if it is clicked repeatedly during its animation', async () => {
    const { state, view, controller } = setup({ manual: true });
    controller.rng = rngFor(6);
    const rolling = controller.requestRoll();
    view.flush();
    await rolling;

    const moving = controller.requestMove(0);
    expect(await controller.requestMove(1)).toBe(false);
    expect(await controller.requestMove(0)).toBe(false);
    await view.finish(moving);
    expect(state.tokens.red).toEqual([0, -1, -1, -1]);
    expect(view.count('animateMove')).toBe(1);
  });

  it('ignores moves before rolling, illegal indexes and non-integers cleanly (no error path)', async () => {
    const { controller, onError, view } = setup({ tokens: { red: [10, -1, -1, -1] } });
    expect(await controller.requestMove(0)).toBe(false);
    await roll(controller, 3);
    const callsBefore = view.calls.length;
    expect(await controller.requestMove(1)).toBe(false);
    expect(await controller.requestMove(9)).toBe(false);
    expect(await controller.requestMove('0')).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(view.calls.length).toBe(callsBefore); // nothing was animated or announced
    expect(await controller.requestMove(0)).toBe(true);
  });
});

describe('resuming a game in progress', () => {
  const resume = (state) => {
    const view = new FakeView();
    const controller = new TurnController(state, view, { onError: vi.fn() });
    controller.start();
    return { view, controller };
  };

  it('resumes mid-turn after a roll: shows the die, the prompt and the movable tokens', async () => {
    const state = makeState({ tokens: { red: [10, 20, -1, -1] } });
    state.rollDice(rngFor(3));
    const { view, controller } = resume(state);
    expect(view.find('showRollResult')).toEqual(['showRollResult', 3]);
    expect(view.find('showPickToken')).toEqual(['showPickToken', 'red', 3]);
    expect(view.movable).toEqual([0, 1]);
    expect(view.rollEnabled).toBe(false);
    expect(await controller.requestMove(1)).toBe(true);
    expect(state.tokens.red[1]).toBe(23);
  });

  it('closes out a turn whose animation was cut short and moves on to the next player', () => {
    const state = makeState({ tokens: { red: [10, -1, -1, -1] } });
    state.rollDice(rngFor(3));
    state.moveToken(0); // outcome decided, animation never finished
    const { view } = resume(state);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
    expect(state.phase).toBe(PHASE.ROLL);
    expect(view.rollEnabled).toBe(true);
  });

  it('keeps the extra turn when the interrupted turn earned one', () => {
    const state = makeState();
    state.rollDice(rngFor(6));
    state.moveToken(0);
    const { view } = resume(state);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'red', true]);
  });

  it('shows the winner again for a finished game, and accepts no input', async () => {
    const state = makeState({ players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    state.rollDice(rngFor(1));
    state.moveToken(3);
    const { view, controller } = resume(state);
    await tick();
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(await controller.requestRoll()).toBe(false);
  });

  it('starts a fresh game at the roll prompt', () => {
    const { view } = resume(makeState());
    expect(view.find('showTurn')).toEqual(['showTurn', 'red', false]);
    expect(view.rollEnabled).toBe(true);
    expect(view.find('showRollResult')).toBeUndefined();
  });
});

describe('victory sequence', () => {
  it('keeps input locked until the victory sequence has finished', async () => {
    const { view, controller } = setup({ manual: true, players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    controller.rng = rngFor(1);
    const rolling = controller.requestRoll();
    await view.finish(rolling);

    const moving = controller.requestMove(3);
    for (let i = 0; i < 20 && !view.find('showWinner'); i++) {
      view.flush();
      await tick();
    }
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(controller.busy).toBe(true); // still celebrating
    expect(await controller.requestRoll()).toBe(false);
    await view.finish(moving);
    expect(controller.busy).toBe(false);
  });
});

describe('shutdown and errors', () => {
  it('does nothing further once disposed mid-animation, even if the animation then resolves', async () => {
    const { view, controller } = setup({ manual: true });
    controller.rng = rngFor(6);
    const rolling = controller.requestRoll();
    controller.dispose();
    const before = view.calls.length;
    view.flush();
    expect(await rolling).toBe(false);
    await tick();
    expect(view.calls.length).toBe(before);
    expect(await controller.requestRoll()).toBe(false);
  });

  it('swallows Cancelled from the view quietly and releases the lock', async () => {
    const { view, controller, onError } = setup();
    view.failOn = 'animateRoll';
    view.failWith = new Cancelled();
    expect(await roll(controller, 6)).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(controller.busy).toBe(false);
  });

  it('recovers from an unexpected error: reports it, unlocks, and keeps the game playable', async () => {
    const { state, view, controller, onError } = setup();
    await roll(controller, 6);
    view.failOn = 'animateMove';
    view.failWith = new Error('boom');
    expect(await controller.requestMove(0)).toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
    expect(controller.busy).toBe(false);
    expect(state.phase).toBe(PHASE.ROLL); // the stuck END phase was closed out
    expect(view.rollEnabled).toBe(true);
    expect(await roll(controller, 6)).toBe(true);
  });

  it('survives an error inside the recovery itself', async () => {
    const { view, controller, onError } = setup();
    await roll(controller, 6);
    view.failOn = 'animateMove';
    view.failWith = new Error('first');
    view.setRollEnabled = () => {
      throw new Error('second');
    };
    await expect(controller.requestMove(0)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(controller.busy).toBe(false);
  });
});





describe('auto-playing a single legal move', () => {
  const setupAuto = (options = {}, auto = true) => {
    const state = makeState(options);
    const view = new FakeView();
    const onError = vi.fn();
    const controller = new TurnController(state, view, { onError, autoSingleMove: auto });
    controller.start();
    return { state, view, controller, onError };
  };

  it('plays the only legal move for the person, showing the token first, without a click', async () => {
    const { state, view, controller } = setupAuto({ tokens: { red: [10, -1, -1, -1] } });
    expect(await roll(controller, 3)).toBe(true);
    expect(state.tokens.red[0]).toBe(13);
    expect(view.find('showAiPick')).toEqual(['showAiPick', 0]);
    expect(view.names().indexOf('showAiPick')).toBeLessThan(view.names().indexOf('animateMove'));
    expect(view.find('showPickToken')).toBeUndefined(); // never asked the person to choose
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
  });

  it('still asks the person to choose when there are several legal moves', async () => {
    const { state, view, controller } = setupAuto({ tokens: { red: [10, 20, -1, -1] } });
    await roll(controller, 3);
    expect(state.tokens.red).toEqual([10, 20, -1, -1]); // nothing moved yet
    expect(view.find('showPickToken')).toEqual(['showPickToken', 'red', 3]);
    expect(view.movable).toEqual([0, 1]);
  });

  it('asks on a 6 when a token can leave the yard as well as move on (several choices)', async () => {
    const { view, controller } = setupAuto({ tokens: { red: [10, -1, -1, -1] } });
    await roll(controller, 6);
    expect(view.movable).toEqual([0, 1, 2, 3]);
  });

  it('keeps the extra turn after an auto-played 6', async () => {
    const { state, view, controller } = setupAuto({ tokens: { red: [45, 56, 56, 56] } }, true); // only token 0 can move
    await roll(controller, 6);
    expect(state.tokens.red[0]).toBe(51);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'red', true]);
  });

  it('does nothing different when no move is possible', async () => {
    const { view, controller } = setupAuto();
    await roll(controller, 3);
    expect(view.find('showNoMoves')).toBeDefined();
    expect(view.find('showAiPick')).toBeUndefined();
  });

  it('is off unless asked for', async () => {
    const { state, view, controller } = setupAuto({ tokens: { red: [10, -1, -1, -1] } }, false);
    await roll(controller, 3);
    expect(state.tokens.red[0]).toBe(10);
    expect(view.movable).toEqual([0]);
  });

  it('ignores clicks while the auto move is happening', async () => {
    const state = makeState({ tokens: { red: [10, -1, -1, -1] } });
    const view = new FakeView({ manual: true });
    const controller = new TurnController(state, view, { onError: vi.fn(), autoSingleMove: true, rng: rngFor(3) });
    controller.start();
    const rolling = controller.requestRoll();
    expect(await controller.requestMove(0)).toBe(false);
    await view.finish(rolling);
    expect(state.tokens.red[0]).toBe(13); // moved exactly once
    expect(view.count('animateMove')).toBe(1);
  });

  it('finishes the move when resumed mid-turn with only one legal move', async () => {
    const state = makeState({ tokens: { red: [10, -1, -1, -1] } });
    state.rollDice(rngFor(3));
    const view = new FakeView();
    const controller = new TurnController(state, view, { onError: vi.fn(), autoSingleMove: true });
    controller.start();
    await tick();
    for (let i = 0; i < 20 && controller.busy; i++) await tick();
    expect(state.tokens.red[0]).toBe(13);
  });
});