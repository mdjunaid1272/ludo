import { describe, it, expect } from 'vitest';
import { GameState, PHASE } from '../src/game/GameState.js';
import { TurnController } from '../src/game/TurnController.js';
import { OnlineGame } from '../src/online/OnlineGame.js';
import { FakeView, tick } from './fakeView.js';
import { makeState, rngFor } from './helpers.js';

const HOME = () => [56, 56, 56, 55];

describe('TurnController after somebody finishes', () => {
  function setup(tokens, { manual = false, players } = {}) {
    const state = makeState({ tokens, players });
    const view = new FakeView({ manual });
    const controller = new TurnController(state, view, { rng: rngFor(1), onError: (e) => { throw e; } });
    controller.start();
    return { state, view, controller };
  }

  it('announces the position, waits for Continue, then plays on with the others', async () => {
    const { state, view, controller } = setup({ red: HOME() }, { manual: true });
    const rolling = controller.requestRoll();
    await view.finish(rolling);
    const moving = controller.requestMove(3);
    for (let i = 0; i < 30 && !view.find('showFinished'); i++) { view.flush(); await tick(); }
    expect(view.find('showFinished')).toEqual(['showFinished', 'red', 1]);
    expect(view.find('showWinner')).toBeUndefined(); // not over
    expect(state.phase).toBe(PHASE.END);
    expect(controller.busy).toBe(true); // locked until Continue
    await view.finish(moving);
    expect(state.currentPlayer).toBe('green');
    expect(state.phase).toBe(PHASE.ROLL);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
    expect(view.rollEnabled).toBe(true);
  });

  it('does not announce the last place separately: the final results come instead', async () => {
    const state = makeState({ tokens: { red: HOME() }, players: ['red', 'green'] });
    const view = new FakeView();
    const controller = new TurnController(state, view, { rng: rngFor(1) });
    controller.start();
    await controller.requestRoll();
    await controller.requestMove(3);
    expect(view.find('showFinished')).toBeUndefined(); // the game is over: the final results replace the popup
  });

  it('shows the final results, once, when the game is over', async () => {
    const state = makeState({ tokens: { red: HOME() }, players: ['red', 'green'] });
    const view = new FakeView();
    const controller = new TurnController(state, view, { rng: rngFor(1) });
    controller.start();
    await controller.requestRoll();
    await controller.requestMove(3);
    expect(view.count('showWinner')).toBe(1);
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(state.rankings).toEqual(['red', 'green']);
    expect(await controller.requestRoll()).toBe(false);
  });

  it('can be rebuilt in the middle (a rotated screen) with a finished player and carries on', async () => {
    const state = makeState({ tokens: { red: HOME() } });
    state.rollDice(rngFor(1));
    state.moveToken(3);
    state.endTurn();
    const view = new FakeView();
    const controller = new TurnController(state, view, { rng: rngFor(1) });
    controller.start();
    expect(view.find('showTurn')).toEqual(['showTurn', 'green', false]);
    expect(await controller.requestRoll()).toBe(true);
    expect(state.rankings).toEqual(['red']);
  });
});

describe('OnlineGame with positions', () => {
  // A server-side copy of the game, to make the events a real server would send.
  const events = (state, ...steps) => steps;
  function setup() {
    const server = makeState({ tokens: { red: HOME() } });
    const sent = [];
    const game = new OnlineGame({ snapshot: server.snapshot(), myColor: 'green', send: (m) => (sent.push(m), true) });
    const view = new FakeView();
    game.attach(view);
    return { server, game, view, sent };
  }
  const feed = async (game, ...messages) => {
    for (const m of messages) game.handle(m);
    for (let i = 0; i < 200 && game.busy; i++) await tick();
  };
  const play = (server, seq) => {
    server.rollDice(rngFor(1));
    const rolled = { t: 'rolled', seq: seq + 1, player: 'red', value: 1, phase: server.phase, forfeited: false, legal: server.legalMoves() };
    const result = server.moveToken(3);
    const moved = { t: 'moved', seq: seq + 2, player: 'red', index: 3, ...result, winner: server.winner, rankings: [...server.rankings] };
    if (server.phase === PHASE.GAME_OVER) return [rolled, moved];
    const extra = server.endTurn();
    const turn = { t: 'turn', seq: seq + 3, player: server.currentPlayer, extra };
    return [rolled, moved, turn];
  };

  it('announces a finish without stopping the game, and then follows the turn to the next player', async () => {
    const { server, game, view } = setup();
    void events;
    await feed(game, ...play(server, 0));
    expect(view.find('showFinished')).toEqual(['showFinished', 'red', 1]);
    expect(view.calls.filter(([n]) => n === 'showRanks').at(-1)).toEqual(['showRanks', ['red']]);
    expect(view.find('showWinner')).toBeUndefined();
    expect(game.state.currentPlayer).toBe('green');
    expect(game.myTurn).toBe(true);
    expect(game.state.rankings).toEqual(['red']);
  });

  it('asks for the real state when its own copy would rank differently from the server', async () => {
    const { server, game, sent } = setup();
    const [rolled, moved] = play(server, 0);
    await feed(game, rolled, { ...moved, rankings: ['green'] }); // the server says green finished: our copy disagrees
    expect(sent).toContainEqual({ t: 'sync' });
  });

  it('shows the final results when the server says the game is over', async () => {
    const server = makeState({ tokens: { red: HOME() }, players: ['red', 'green'] });
    const game = new OnlineGame({ snapshot: server.snapshot(), myColor: 'green', send: () => true });
    const view = new FakeView();
    game.attach(view);
    await feed(game, ...play(server, 0).slice(0, 2));
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(view.find('showFinished')).toBeUndefined();
    expect(game.myTurn).toBe(false); // over: nobody's turn
  });

  it('shows the medals again when the screen is rebuilt or the state restored from a snapshot', async () => {
    const { server, game } = setup();
    await feed(game, ...play(server, 0));
    const next = new FakeView();
    game.attach(next);
    expect(next.calls.filter(([n]) => n === 'showRanks').at(-1)).toEqual(['showRanks', ['red']]);
    await feed(game, { t: 'snapshot', snapshot: server.snapshot(), seq: 3 });
    expect(next.calls.filter(([n]) => n === 'showRanks').length).toBeGreaterThan(1);
  });

  it('accepts a snapshot with rankings and refuses one that is inconsistent', () => {
    const s = makeState({ tokens: { red: HOME() } });
    s.rollDice(rngFor(1));
    s.moveToken(3);
    expect(() => GameState.fromSnapshot(s.snapshot())).not.toThrow();
    expect(() => GameState.fromSnapshot({ ...s.snapshot(), rankings: ['green'] })).toThrow(/Invalid snapshot/);
  });
});

describe('bot thinking time in a game on one device', () => {
  it('asks for a new wait (a function of its own) each time a bot is about to roll', async () => {
    const state = makeState({ players: ['red', 'green'] });
    const view = new FakeView({ manual: true }); // animations and pauses are held until we release them
    const waits = [2100, 4900, 3000];
    const controller = new TurnController(state, view, { rng: rngFor(3), computers: ['red', 'green'], chooseMove: (s) => s.legalMoves()[0], thinkMs: () => waits.shift() ?? 2000 });
    controller.start();
    for (let i = 0; i < 40; i++) { view.flush(); await tick(); }
    const pauses = view.calls.filter(([n]) => n === 'pause').map(([, ms]) => ms);
    expect(pauses.filter((ms) => [2100, 4900, 3000].includes(ms))).toEqual([2100, 4900, 3000]);
  });
});

describe('OnlineGame when somebody leaves the game', () => {
  const setup3 = () => {
    const server = makeState({ players: ['red', 'green', 'yellow'] });
    const sent = [];
    const game = new OnlineGame({ snapshot: server.snapshot(), myColor: 'red', send: (m) => (sent.push(m), true) });
    const view = new FakeView();
    view.showLeft = (...a) => view.calls.push(['showLeft', ...a]);
    game.attach(view);
    return { server, game, view, sent };
  };
  const feed = async (game, ...messages) => {
    for (const m of messages) game.handle(m);
    for (let i = 0; i < 200 && game.busy; i++) await tick();
  };

  it('takes them out of its copy, shows them as gone, and follows the turn the server passes on', async () => {
    const { server, game, view } = setup3();
    server.removePlayer('red'); // red's turn: they leave
    const left = { t: 'left', seq: 1, player: 'red', over: false, winner: null, rankings: [] };
    const extra = server.endTurn();
    const turn = { t: 'turn', seq: 2, player: server.currentPlayer, extra };
    await feed(game, left, turn);
    expect(game.state.left).toEqual(['red']);
    expect(view.find('showLeft')).toEqual(['showLeft', 'red']);
    expect(game.state.currentPlayer).toBe('green');
    expect(game.state.snapshot()).toEqual(server.snapshot());
  });

  it('shows the final results when the server says the leaver left one player alone', async () => {
    const { server, game, view } = setup3();
    server.removePlayer('green');
    await feed(game, { t: 'left', seq: 1, player: 'green', over: false, winner: null, rankings: [] });
    server.removePlayer('yellow');
    await feed(game, { t: 'left', seq: 2, player: 'yellow', over: true, winner: 'red', rankings: [...server.rankings] });
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(game.state.rankings).toEqual(['red', 'yellow', 'green']);
  });

  it('asks for the real state when its copy disagrees about whether the game is over', async () => {
    const { game, sent } = setup3();
    await feed(game, { t: 'left', seq: 1, player: 'green', over: true, winner: 'red', rankings: ['red', 'yellow', 'green'] });
    expect(sent).toContainEqual({ t: 'sync' });
  });

  it('shows the players who left again when the screen is rebuilt', async () => {
    const { server, game } = setup3();
    server.removePlayer('green');
    await feed(game, { t: 'left', seq: 1, player: 'green', over: false, winner: null, rankings: [] });
    const next = new FakeView();
    next.showLeft = (...a) => next.calls.push(['showLeft', ...a]);
    game.attach(next);
    expect(next.find('showLeft')).toEqual(['showLeft', 'green']);
  });
});
