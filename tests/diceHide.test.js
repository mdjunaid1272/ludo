import { describe, expect, it } from 'vitest';
import { TurnController } from '../src/game/TurnController.js';
import { FakeView } from './fakeView.js';
import { makeState, rngFor } from './helpers.js';

// A view that also has the die shrinking away (an optional part of the view).
class DiceView extends FakeView {
  hideDice() {
    this.calls.push(['hideDice']);
    return Promise.resolve();
  }
}

const setup = () => {
  const state = makeState();
  const view = new DiceView();
  const controller = new TurnController(state, view, { onError: () => {} });
  controller.start();
  return { state, view, controller };
};

describe('the die shrinks away once the turn is played', () => {
  it('after the token has landed, before the next turn begins', async () => {
    const { view, controller } = setup();
    controller.rng = rngFor(6);
    await controller.requestRoll();
    await controller.requestMove(2);
    expect(view.names().slice(-4)).toEqual(['settle', 'hideDice', 'showTurn', 'setRollEnabled']);
  });

  it('after a roll with no move, too', async () => {
    const { view, controller } = setup();
    controller.rng = rngFor(3); // every token is in the yard: no move
    await controller.requestRoll();
    expect(view.names()).toContain('showNoMoves');
    const names = view.names();
    expect(names.indexOf('hideDice')).toBeGreaterThan(names.indexOf('showNoMoves'));
    expect(names.indexOf('hideDice')).toBeLessThan(names.lastIndexOf('showTurn'));
  });

  it('is left out by views that cannot do it (the die is optional for them)', async () => {
    const state = makeState();
    const view = new FakeView();
    const controller = new TurnController(state, view, { onError: () => {} });
    controller.start();
    controller.rng = rngFor(6);
    await controller.requestRoll();
    await controller.requestMove(0);
    expect(view.names()).not.toContain('hideDice');
    expect(view.names().slice(-2)).toEqual(['showTurn', 'setRollEnabled']);
  });
});
