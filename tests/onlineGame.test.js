import { describe, it, expect, vi } from 'vitest';
import { OnlineGame } from '../src/online/OnlineGame.js';
import { GameState, PHASE } from '../src/game/GameState.js';
import { Cancelled } from '../src/game/Cancelled.js';
import { FINISHED } from '../src/game/path.js';
import { FakeView, tick } from './fakeView.js';
import { makeState, rngFor } from './helpers.js';

// Produces the events the real server would send for a game, from its own authoritative copy.
class FakeServer {
  constructor(state) {
    this.state = state;
    this.seq = 0;
  }

  roll(value, flags = {}) {
    const player = this.state.currentPlayer;
    this.state.rollDice(rngFor(value));
    return { t: 'rolled', seq: ++this.seq, player, value, forfeited: this.state.forfeited, phase: this.state.phase, legal: this.state.legalMoves(), ...flags };
  }

  move(index, flags = {}) {
    const player = this.state.currentPlayer;
    const result = this.state.moveToken(index);
    return { t: 'moved', seq: ++this.seq, player, index, ...result, winner: this.state.winner, ...flags };
  }

  turn(flags = {}) {
    const extra = this.state.endTurn();
    return { t: 'turn', seq: ++this.seq, player: this.state.currentPlayer, extra, ...flags };
  }

  snapshot(flags = {}) {
    return { t: 'snapshot', snapshot: this.state.snapshot(), seq: this.seq, ...flags };
  }
}

const idle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i++) await tick();
};

function setup({ myColor = 'red', manual = false, attach = true, ...stateOptions } = {}) {
  const server = new FakeServer(makeState(stateOptions));
  const sent = [];
  const onError = vi.fn();
  const onFatal = vi.fn();
  const game = new OnlineGame({ snapshot: server.state.snapshot(), myColor, send: (m) => (sent.push(m), true), onError, onFatal });
  const view = new FakeView({ manual });
  if (attach) game.attach(view);
  return { game, server, view, sent, onError, onFatal };
}
// Delivers events and waits until the game has finished applying (and animating) all of them.
const feed = async (game, ...events) => {
  for (const e of events) game.handle(e);
  for (let i = 0; i < 400 && (i === 0 || game.busy); i++) await tick();
};

describe('presenting the state', () => {
  it('lets me roll when it is my turn, and not otherwise', () => {
    const mine = setup({ myColor: 'red' });
    expect(mine.view.rollEnabled).toBe(true);
    expect(mine.view.find('showTurn')).toEqual(['showTurn', 'red', false]);
    const theirs = setup({ myColor: 'green' });
    expect(theirs.view.rollEnabled).toBe(false);
  });

  it('shows the move prompt after a roll when attached mid-turn: mine is clickable, theirs is a non-clickable highlight', () => {
    const state = { tokens: { red: [10, 20, -1, -1] } };
    const mine = setup({ myColor: 'red', attach: false, ...state });
    mine.server.state.rollDice(rngFor(3));
    mine.game.state.restore(mine.server.state.snapshot());
    mine.game.attach(mine.view);
    expect(mine.view.find('showRollResult')).toEqual(['showRollResult', 3]);
    expect(mine.view.find('showPickToken')).toEqual(['showPickToken', 'red', 3]);
    expect(mine.view.movable).toEqual([0, 1]);
    expect(mine.view.interactive).toBe(true);

    const theirs = setup({ myColor: 'green', attach: false, ...state });
    theirs.server.state.rollDice(rngFor(3));
    theirs.game.state.restore(theirs.server.state.snapshot());
    theirs.game.attach(theirs.view);
    expect(theirs.view.find('showWaiting')).toEqual(['showWaiting', 'red', 3]);
    expect(theirs.view.interactive).toBe(false);
    expect(theirs.view.find('showPickToken')).toBeUndefined();
  });

  it('shows the winner for a finished game', () => {
    const s = setup({ attach: false, players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    s.server.state.rollDice(rngFor(1));
    s.server.state.moveToken(3);
    s.game.state.restore(s.server.state.snapshot());
    s.game.attach(s.view);
    expect(s.view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(s.view.rollEnabled).toBe(false);
  });
});

describe('sending requests', () => {
  it('asks the server to roll, disables the die, and ignores a second click until the server answers', async () => {
    const { game, view, sent, server } = setup();
    expect(game.requestRoll()).toBe(true);
    expect(sent).toEqual([{ t: 'roll' }]);
    expect(view.rollEnabled).toBe(false);
    expect(game.requestRoll()).toBe(false);
    expect(sent).toHaveLength(1);
    await feed(game, server.roll(6));
    expect(game.busy).toBe(false);
  });

  it('does nothing when it is not my turn, or when nothing is attached', () => {
    const theirs = setup({ myColor: 'green' });
    expect(theirs.game.requestRoll()).toBe(false);
    expect(theirs.sent).toHaveLength(0);
    const detached = setup({ attach: false });
    expect(detached.game.requestRoll()).toBe(false);
  });

  it('asks to move only a legal token, only after rolling, and only once', async () => {
    const { game, server, sent, view } = setup({ tokens: { red: [10, -1, -1, -1] } });
    expect(game.requestMove(0)).toBe(false); // not rolled yet
    game.requestRoll();
    await feed(game, server.roll(3));
    expect(game.requestMove(1)).toBe(false); // that token is in the yard: not legal on a 3
    expect(game.requestMove(9)).toBe(false);
    expect(game.requestMove(0)).toBe(true);
    expect(sent.at(-1)).toEqual({ t: 'move', index: 0 });
    expect(view.movable).toEqual([]);
    expect(game.requestMove(0)).toBe(false); // still waiting for the answer
    expect(sent.filter((m) => m.t === 'move')).toHaveLength(1);
  });

  it('lets me try again if the server rejects a request', () => {
    const { game, view, sent } = setup();
    game.requestRoll();
    expect(view.rollEnabled).toBe(false);
    game.rejected();
    expect(view.rollEnabled).toBe(true);
    expect(game.requestRoll()).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('gives the input back if the message could not be sent', () => {
    const { game, view } = setup();
    game.send = () => false;
    expect(game.requestRoll()).toBe(false);
    expect(view.rollEnabled).toBe(true);
    expect(game.busy).toBe(false);
  });
});

describe('applying server events', () => {
  it('rolls, prompts me to pick, moves, passes the turn, and enables the next player', async () => {
    const { game, view, server } = setup({ tokens: { red: [10, -1, -1, -1] } });
    game.requestRoll();
    await feed(game, server.roll(3));
    expect(view.find('animateRoll')).toEqual(['animateRoll', 3]);
    expect(view.find('showPickToken')).toEqual(['showPickToken', 'red', 3]);
    expect(view.movable).toEqual([0]);

    game.requestMove(0);
    await feed(game, server.move(0), server.turn());
    expect(view.find('animateMove')).toEqual(['animateMove', 'red', 0, 10, 13]);
    expect(view.names().indexOf('animateMove')).toBeLessThan(view.names().indexOf('settle'));
    expect(game.state.tokens.red[0]).toBe(13);
    expect(view.calls.filter(([n]) => n === 'showTurn').at(-1)).toEqual(['showTurn', 'green', false]);
    expect(view.rollEnabled).toBe(false); // green's turn, not mine
    expect(game.seq).toBe(3);
  });

  it("shows another player's roll as waiting (not as a prompt for me), including a computer's", async () => {
    const { game, view, server } = setup({ myColor: 'green', tokens: { red: [10, -1, -1, -1] } });
    await feed(game, server.roll(3, { ai: true }));
    expect(view.find('showWaiting')).toEqual(['showWaiting', 'red', 3]);
    expect(view.find('showPickToken')).toBeUndefined();
    expect(view.interactive).toBe(false);
  });

  it('treats my own auto-played roll (after a timeout) as not clickable', async () => {
    const { game, view, server } = setup({ tokens: { red: [10, -1, -1, -1] } });
    await feed(game, server.roll(3, { auto: true }));
    expect(view.find('showPickToken')).toBeUndefined();
    expect(view.interactive).toBe(false);
  });

  it('reports no moves, pauses, and moves on to the next turn', async () => {
    const { game, view, server } = setup();
    await feed(game, server.roll(3), server.turn());
    expect(view.find('showNoMoves')).toEqual(['showNoMoves', 'red', 3, false]);
    expect(view.find('pause')).toEqual(['pause', 900]);
    expect(game.state.currentPlayer).toBe('green');
  });

  it('announces captures between the move and the settle', async () => {
    const green = (3 - 13 + 52) % 52;
    const { game, view, server } = setup({ tokens: { red: [1, -1, -1, -1], green: [green, -1, -1, -1] } });
    game.requestRoll();
    await feed(game, server.roll(2));
    game.requestMove(0);
    await feed(game, server.move(0), server.turn());
    const order = view.names().filter((n) => ['animateMove', 'announceCapture', 'animateCaptures', 'settle'].includes(n));
    expect(order).toEqual(['animateMove', 'announceCapture', 'animateCaptures', 'settle']);
    expect(game.state.tokens.green[0]).toBe(-1);
  });

  it('shows the winner', async () => {
    const { game, view, server } = setup({ players: ['red', 'green'], tokens: { red: [FINISHED, FINISHED, FINISHED, 55] } });
    game.requestRoll();
    await feed(game, server.roll(1));
    game.requestMove(3);
    await feed(game, server.move(3));
    expect(view.find('showWinner')).toEqual(['showWinner', 'red']);
    expect(game.state.winner).toBe('red');
  });

  it('plays each event only after the previous one has finished animating', async () => {
    const { game, view, server } = setup({ manual: true, tokens: { red: [10, -1, -1, -1] } });
    game.handle(server.roll(3));
    game.handle(server.move(0));
    await idle(5);
    expect(view.count('animateRoll')).toBe(1);
    expect(view.count('animateMove')).toBe(0); // still waiting for the roll animation
    expect(game.busy).toBe(true);
    await view.finish(Promise.resolve());
    for (let i = 0; i < 20 && game.busy; i++) {
      view.flush();
      await tick();
    }
    expect(view.count('animateMove')).toBe(1);
    expect(game.busy).toBe(false);
  });

  it('keeps applying events with no view attached, and presents the right screen when one attaches', async () => {
    const { game, server } = setup({ attach: false, tokens: { red: [10, -1, -1, -1] } });
    await feed(game, server.roll(3), server.move(0), server.turn());
    expect(game.state.tokens.red[0]).toBe(13);
    expect(game.state.currentPlayer).toBe('green');
    const later = new FakeView();
    game.attach(later);
    expect(later.find('showTurn')).toEqual(['showTurn', 'green', false]);
    expect(later.rollEnabled).toBe(false);
  });

  it('survives the view being detached mid-animation, then a new view attached', async () => {
    const { game, view, server } = setup({ manual: true, tokens: { red: [10, -1, -1, -1] } });
    game.handle(server.roll(3));
    await idle(3);
    game.detach();
    view.waiters.splice(0).forEach((w) => w.resolve());
    await feed(game, server.move(0), server.turn());
    expect(game.state.tokens.red[0]).toBe(13);
    const fresh = new FakeView();
    game.attach(fresh);
    expect(fresh.find('showTurn')).toEqual(['showTurn', 'green', false]);
  });

  it('shrugs off a cancelled animation (the screen was rebuilt) without reporting an error', async () => {
    const { game, view, server, onError } = setup({ tokens: { red: [10, -1, -1, -1] } });
    view.failOn = 'animateRoll';
    view.failWith = new Cancelled();
    await feed(game, server.roll(3));
    expect(onError).not.toHaveBeenCalled();
    expect(game.state.phase).toBe(PHASE.MOVE); // the state was still updated
  });
});

describe('staying in step with the server', () => {
  it('ignores duplicate events', async () => {
    const { game, server } = setup({ tokens: { red: [10, -1, -1, -1] } });
    const e = server.roll(3);
    await feed(game, e, e, e);
    expect(game.state.phase).toBe(PHASE.MOVE);
    expect(game.seq).toBe(1);
  });

  it('asks for a resync when an event is missing, ignores events until the snapshot arrives, then carries on', async () => {
    const { game, server, sent, view } = setup({ tokens: { red: [10, -1, -1, -1] } });
    const lost = server.roll(3); // never delivered
    const move = server.move(0);
    const turn = server.turn();
    await feed(game, move);
    expect(sent).toEqual([{ t: 'sync' }]);
    await feed(game, turn); // arrives while waiting: ignored
    expect(sent).toHaveLength(1);
    expect(game.state.tokens.red[0]).toBe(10); // untouched so far
    void lost;
    await feed(game, server.snapshot());
    expect(game.state.snapshot()).toEqual(server.state.snapshot());
    expect(game.seq).toBe(3);
    expect(view.calls.filter(([n]) => n === 'settle').length).toBeGreaterThan(0);
    // and it is playing normally again
    const next = server.roll(6);
    await feed(game, next);
    expect(game.state.snapshot()).toEqual(server.state.snapshot());
  });

  it('asks for a resync when an event does not fit the local state', async () => {
    const { game, server, sent } = setup();
    const roll = server.roll(6);
    await feed(game, { ...roll, phase: 'end' }); // claims a different outcome than the local engine computes
    expect(sent).toEqual([{ t: 'sync' }]);
    const s2 = setup();
    await feed(s2.game, { t: 'turn', seq: 1, player: 'green', extra: false }); // a turn event while still rolling
    expect(s2.sent).toEqual([{ t: 'sync' }]);
    const s3 = setup();
    await feed(s3.game, { t: 'moved', seq: 1, player: 'red', index: 0, from: -1, to: 0, captured: [] });
    expect(s3.sent).toEqual([{ t: 'sync' }]);
  });

  it('reports a fatal error for a corrupt snapshot and leaves the state alone', async () => {
    const { game, server, onFatal } = setup();
    const before = JSON.stringify(game.state.snapshot());
    const bad = server.snapshot();
    bad.snapshot.tokens.red = [1, 2];
    await feed(game, bad);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(game.state.snapshot())).toBe(before);
  });

  it('stops reacting after dispose', async () => {
    const { game, server, sent } = setup();
    game.dispose();
    await feed(game, server.roll(6));
    expect(game.state.phase).toBe(PHASE.ROLL);
    expect(game.requestRoll()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('is a GameState replica: the same events give the same state as the server, step by step', async () => {
    const { game, server } = setup({ tokens: { red: [10, 20, -1, -1], green: [5, -1, -1, -1] } });
    const rolls = [6, 2, 4, 1, 3, 5, 6, 6, 2];
    for (const value of rolls) {
      const roll = server.roll(value);
      await feed(game, roll);
      if (server.state.phase === PHASE.MOVE) await feed(game, server.move(server.state.legalMoves()[0]));
      await feed(game, server.turn());
      expect(game.state.snapshot()).toEqual(server.state.snapshot());
    }
    expect(game.state).toBeInstanceOf(GameState);
  });
});

describe('heartbeat sequence check', () => {
  it('asks for the full state when the server is ahead of us and nothing exposed the gap', async () => {
    const { game, server, sent } = setup();
    server.roll(6); // never delivered
    game.checkSeq(server.seq);
    await feed(game);
    expect(sent).toEqual([{ t: 'sync' }]);
  });

  it('does nothing when we are up to date, including events still being applied', async () => {
    const { game, server, sent } = setup({ tokens: { red: [10, -1, -1, -1] } });
    const roll = server.roll(3);
    game.handle(roll);
    game.checkSeq(server.seq); // arrives right after the event: it is applied first, then the check runs
    await feed(game);
    expect(sent).toEqual([]);
    game.checkSeq(server.seq);
    game.checkSeq(0);
    await feed(game);
    expect(sent).toEqual([]);
  });

  it('ignores a missing or invalid sequence number, and asks only once while a sync is pending', async () => {
    const { game, server, sent } = setup();
    for (const bad of [null, undefined, '5', 1.5, NaN]) game.checkSeq(bad);
    await feed(game);
    expect(sent).toEqual([]);
    server.roll(6);
    game.checkSeq(1);
    game.checkSeq(1);
    await feed(game);
    expect(sent).toEqual([{ t: 'sync' }]);
  });
});
describe('when the server plays the only legal move', () => {
  it('shows "choosing" instead of asking me to pick, and makes nothing clickable', async () => {
    const { game, view, server } = setupNoAttach();
    game.attach(view);
    game.requestRoll();
    await feed(game, server.roll(3, { autoMove: true }));
    expect(view.find('showPickToken')).toBeUndefined();
    expect(view.find('showWaiting')).toEqual(['showWaiting', 'red', 3]);
    expect(view.interactive).toBe(false);
    await feed(game, server.move(0, { forced: true }), server.turn());
    expect(game.state.tokens.red[0]).toBe(13);
  });
});

function setupNoAttach() {
  const s = setup({ attach: false, tokens: { red: [10, -1, -1, -1] } });
  return s;
}
describe('telling the person when the computer played their turn', () => {
  const withNotify = (myColor) => {
    const server = new FakeServer(makeState({ tokens: { red: [10, -1, -1, -1] } }));
    const notify = vi.fn();
    const game = new OnlineGame({ snapshot: server.state.snapshot(), myColor, send: () => true, notify });
    game.attach(new FakeView());
    return { game, server, notify };
  };

  it('notifies me when my own roll was played automatically after a timeout', async () => {
    const { game, server, notify } = withNotify('red');
    await feed(game, server.roll(3, { auto: true }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/computer played your turn/);
  });

  it('does not notify for other people\'s turns, computer seats, or normal rolls', async () => {
    const other = withNotify('green');
    await feed(other.game, other.server.roll(3, { auto: true }));
    const mine = withNotify('red');
    await feed(mine.game, mine.server.roll(3));
    expect(other.notify).not.toHaveBeenCalled();
    expect(mine.notify).not.toHaveBeenCalled();
  });
});

describe('the turn countdown', () => {
  const timerCalls = (view) => view.calls.filter(([n]) => n === 'startTurnTimer' || n === 'stopTurnTimer');

  it('starts for the player who has to roll, with the time the server gave', async () => {
    const { game, server, view } = setup({ myColor: 'green' });
    await feed(game, server.roll(3), server.turn({ timeoutMs: 15_000 })); // red rolls a 3 (no move); green has to roll
    const start = view.find('startTurnTimer');
    expect(start[1]).toBe('green');
    expect(start[2]).toBeGreaterThan(14_000);
    expect(start[2]).toBeLessThanOrEqual(15_000);
  });

  it('starts for the player who has to choose a token, and is cleared when they have moved', async () => {
    const { game, server, view } = setup({ myColor: 'red' });
    await feed(game, server.roll(6, { timeoutMs: 15_000 }));
    expect(view.find('startTurnTimer').slice(0, 2)).toEqual(['startTurnTimer', 'red']);
    view.calls.length = 0;
    await feed(game, server.move(0));
    expect(view.names()).toContain('stopTurnTimer');
    expect(view.names()).not.toContain('startTurnTimer');
  });

  it('is cleared when nobody is being waited for (an event without a time)', async () => {
    const { game, server, view } = setup({ myColor: 'red' });
    await feed(game, server.roll(3), server.turn({ timeoutMs: 15_000 })); // the countdown is running for green
    view.calls.length = 0;
    await feed(game, server.roll(3)); // green rolls a 3: no move, no time given
    expect(view.names()).toContain('stopTurnTimer');
    expect(view.names()).not.toContain('startTurnTimer');
  });

  it('counts from when the message arrived, not from when its turn in the animation queue came', async () => {
    const real = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const { game, server, view } = setup({ myColor: 'green', manual: true });
      game.handle(server.roll(3)); // red's roll animation is being held open
      await idle(5);
      game.handle(server.turn({ timeoutMs: 15_000 })); // arrives now (t = 0) but waits behind the animation
      await idle(5);
      expect(view.find('startTurnTimer')).toBeUndefined();
      now += 800; // the animation takes 0.8 s
      await feed(game);
      for (let i = 0; i < 20 && !view.find('startTurnTimer'); i++) { view.flush(); await tick(); }
      expect(view.find('startTurnTimer')[2]).toBe(14_200); // 15 s minus the 0.8 s it waited
    } finally {
      Date.now = real;
    }
  });

  it('comes back, with the time that is left, when the screen is rebuilt (a rotated phone)', async () => {
    const real = Date.now;
    let now = 5_000;
    Date.now = () => now;
    try {
      const { game, server, view } = setup({ myColor: 'green' });
      await feed(game, server.roll(3), server.turn({ timeoutMs: 15_000 }));
      game.detach();
      now += 6_000;
      const next = new FakeView();
      game.attach(next);
      expect(next.find('startTurnTimer')).toEqual(['startTurnTimer', 'green', 9_000]);
      expect(view.count('startTurnTimer')).toBe(1);
    } finally {
      Date.now = real;
    }
  });

  it('is not shown again once its time has run out and the screen is rebuilt', async () => {
    const real = Date.now;
    let now = 5_000;
    Date.now = () => now;
    try {
      const { game, server } = setup({ myColor: 'green' });
      await feed(game, server.roll(3), server.turn({ timeoutMs: 15_000 }));
      game.detach();
      now += 16_000;
      const next = new FakeView();
      game.attach(next);
      expect(next.find('startTurnTimer')).toBeUndefined();
      expect(next.names()).toContain('stopTurnTimer');
    } finally {
      Date.now = real;
    }
  });

  it('is restored from a snapshot (after reconnecting or resyncing), for the player whose move it is', async () => {
    const { game, server, view } = setup({ myColor: 'green' });
    server.state.rollDice(rngFor(6)); // red rolled a 6 and is choosing (the server's copy moved on; the client missed it)
    server.seq = 7;
    await feed(game, server.snapshot({ timeoutMs: 9_000 }));
    const start = view.find('startTurnTimer');
    expect(start.slice(0, 2)).toEqual(['startTurnTimer', 'red']);
    expect(start[2]).toBeGreaterThan(8_000);
    expect(start[2]).toBeLessThanOrEqual(9_000);
  });

  it('starts when the game itself starts (the opening time comes with the started message), and not for a finished game', () => {
    const server = new FakeServer(makeState({}));
    const build = (extra) => {
      const game = new OnlineGame({ snapshot: server.state.snapshot(), myColor: 'red', send: () => true, ...extra });
      const view = new FakeView();
      game.attach(view);
      return view;
    };
    const view = build({ timeoutMs: 15_000 });
    const start = view.find('startTurnTimer');
    expect(start.slice(0, 2)).toEqual(['startTurnTimer', 'red']);
    expect(start[2]).toBeGreaterThan(14_000);
    expect(build({}).find('startTurnTimer')).toBeUndefined();
  });
  it('is not started by a snapshot without a time', async () => {
    const { game, server, view } = setup({ myColor: 'red' });
    await feed(game, server.snapshot());
    expect(view.find('startTurnTimer')).toBeUndefined();
  });

  it('still works with a view that has no countdown (an older screen)', async () => {
    const { game, server, view } = setup({ myColor: 'green' });
    view.startTurnTimer = undefined;
    view.stopTurnTimer = undefined;
    view.calls.length = 0;
    await feed(game, server.roll(3), server.turn({ timeoutMs: 15_000 }), server.roll(3));
    expect(timerCalls(view)).toHaveLength(0);
  });
});