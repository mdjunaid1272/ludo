import { Cancelled } from '../game/Cancelled.js';
import { GameState, PHASE } from '../game/GameState.js';

const NO_MOVE_PAUSE_MS = 900;
const rngFor = (value) => () => (value - 1) / 6 + 0.01; // makes rollDice() return exactly `value`

// The client side of an online game. The server decides everything; this keeps a local copy of the game
// (`state`) in step by applying the server's events in order, and shows them on a view (the same view
// interface TurnController uses). When the player clicks, it only *asks* the server (send roll / send move).
//
// It outlives any one screen: when the screen is rebuilt (rotation) the view is detached and a new one is
// attached, and the game carries on from `state`. Events that arrive while no view is attached are still
// applied, just without animation.
export class OnlineGame {
  #chain = Promise.resolve();
  #queued = 0;
  #syncing = false;
  #waiting = false; // we asked the server to do something and its answer has not arrived yet
  #disposed = false;
  #timer = null; // { player, endsAt }: the countdown the server started for the person whose move it is (our clock)

  // `timeoutMs`: the time the person whose move it is has left, when the game starts or is rejoined.
  constructor({ snapshot, seq = 0, timeoutMs = null, myColor, send, onError = (e) => console.error(e), onFatal = () => {}, notify = () => {} }) {
    this.state = GameState.fromSnapshot(snapshot);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0 && this.state.phase !== PHASE.GAME_OVER) this.#timer = { player: this.state.currentPlayer, endsAt: Date.now() + timeoutMs };
    this.seq = seq;
    this.myColor = myColor;
    this.send = send;
    this.onError = onError;
    this.onFatal = onFatal;
    this.notify = notify; // tells the person something (shown as a message on screen)
    this.view = null;
  }

  get busy() {
    return this.#queued > 0 || this.#waiting;
  }

  get myTurn() {
    return this.state.phase !== PHASE.GAME_OVER && this.state.currentPlayer === this.myColor; // a player who has finished is never the current one
  }

  // --- input from the person ---------------------------------------------------------------------

  requestRoll() {
    if (this.#disposed || this.busy || !this.view || !this.myTurn || this.state.phase !== PHASE.ROLL) return false;
    this.#waiting = true;
    this.view.setRollEnabled(false);
    return this.send({ t: 'roll' }) || this.#release();
  }

  requestMove(index) {
    if (this.#disposed || this.busy || !this.view || !this.myTurn || this.state.phase !== PHASE.MOVE) return false;
    if (!this.state.legalMoves().includes(index)) return false;
    this.#waiting = true;
    this.view.setMovable([]);
    return this.send({ t: 'move', index }) || this.#release();
  }

  // The server's heartbeat reply carries its latest event number. If we are behind (we missed events and nothing
  // later has exposed the gap), ask for the full state. Checked after every event already received.
  checkSeq(serverSeq) {
    if (this.#disposed || !Number.isInteger(serverSeq)) return;
    this.#chain = this.#chain.then(() => {
      if (!this.#syncing && serverSeq > this.seq) this.#desync();
    });
  }

  // The server refused something we asked for: let the person try again.

  rejected() {
    if (!this.#waiting) return;
    this.#waiting = false;
    this.#present();
  }

  #release() {
    this.#waiting = false;
    this.#present();
    return false;
  }

  // --- the view --------------------------------------------------------------------------------

  attach(view) {
    this.view = view;
    this.#present();
  }

  detach() {
    this.view = null;
  }

  dispose() {
    this.#disposed = true;
    this.view = null;
  }

  // The server gave player ms to act, counted from since (when the message arrived): show the countdown. ms missing
  // means nobody is being waited for (a computer, a move played by itself), so there is no countdown.
  #startTimer(player, ms, since) {
    this.#timer = Number.isFinite(ms) && ms > 0 ? { player, endsAt: since + ms } : null;
    this.#showTimer();
  }

  #stopTimer() {
    this.#timer = null;
    this.view?.stopTurnTimer?.();
  }

  // Puts the countdown (with the time that is left now) on the view; used when it starts and when a screen is rebuilt.
  #showTimer() {
    const view = this.view;
    if (!view) return;
    const left = this.#timer ? this.#timer.endsAt - Date.now() : 0;
    if (left > 0) view.startTurnTimer?.(this.#timer.player, left);
    else view.stopTurnTimer?.();
  }

  // Shows the screen for the current state: whose turn it is, and what the person can do.
  #present() {
    const { state, view } = this;
    if (!view || this.#disposed) return;
    this.#showTimer();
    view.showRanks?.(state.rankings);
    for (const seat of state.left) view.showLeft?.(seat);
    const player = state.currentPlayer;
    const mine = player === this.myColor;
    switch (state.phase) {
      case PHASE.ROLL:
        view.showTurn(player, false);
        view.setRollEnabled(mine && !this.#waiting);
        view.setMovable([]);
        break;
      case PHASE.MOVE:
        view.showTurn(player, false);
        view.setRollEnabled(false);
        view.showRollResult(state.roll);
        if (mine && !this.#waiting) {
          view.showPickToken(player, state.roll);
          view.setMovable(state.legalMoves());
        } else {
          view.showWaiting(player, state.roll);
          view.setMovable(state.legalMoves(), false);
        }
        break;
      case PHASE.END:
        view.setRollEnabled(false);
        break;
      default:
        view.setRollEnabled(false);
        view.showWinner(state.winner);
    }
  }

  // --- events from the server ---------------------------------------------------------------------

  // Called for every game message from the server (rolled, moved, turn, snapshot). They are applied one at a
  // time, in order, each waiting for the previous one's animations to finish.
  handle(message) {
    if (this.#disposed) return;
    this.#queued += 1;
    const arrived = { ...message, receivedAt: Date.now() };
    this.#chain = this.#chain
      .then(() => this.#process(arrived))
      .catch((error) => {
        if (error instanceof Cancelled) return;
        this.onError(error);
        this.#desync();
      })
      .finally(() => {
        this.#queued -= 1;
      });
  }

  async #process(m) {
    if (this.#disposed) return;
    if (m.t === 'snapshot') return this.#applySnapshot(m);
    if (this.#syncing) return; // waiting for the snapshot we asked for
    if (m.seq <= this.seq) return; // already applied (a duplicate)
    if (m.seq !== this.seq + 1) return this.#desync(); // we missed something
    this.seq = m.seq;
    this.#waiting = false;
    if (m.t === 'rolled') await this.#onRolled(m);
    else if (m.t === 'moved') await this.#onMoved(m);
    else if (m.t === 'left') await this.#onLeft(m);
    else if (m.t === 'turn') this.#onTurn(m);
  }

  async #onRolled(m) {
    const { state, view } = this;
    if (state.phase !== PHASE.ROLL || state.currentPlayer !== m.player) return this.#desync();
    state.rollDice(rngFor(m.value));
    if (state.phase !== m.phase || state.roll !== m.value) return this.#desync();
    if (m.auto && m.player === this.myColor) this.notify('Time ran out, so the computer played your turn.');
    this.#startTimer(m.player, m.timeoutMs, m.receivedAt); // the pick-a-token countdown, when a person has to choose
    if (!view) return;

    view.setRollEnabled(false);
    await view.animateRoll(m.value);
    if (state.phase === PHASE.END) {
      view.showNoMoves(m.player, m.value, state.forfeited);
      await view.pause(NO_MOVE_PAUSE_MS);
      await view.hideDice?.();
    } else if (m.player === this.myColor && !m.auto && !m.ai && !m.autoMove) {
      view.showPickToken(m.player, m.value);
      view.setMovable(state.legalMoves());
    } else {
      view.showWaiting(m.player, m.value);
      view.setMovable(state.legalMoves(), false);
    }
  }

  async #onMoved(m) {
    const { state, view } = this;
    if (state.phase !== PHASE.MOVE || state.currentPlayer !== m.player) return this.#desync();
    const result = state.moveToken(m.index);
    if (result.from !== m.from || result.to !== m.to || result.captured.length !== m.captured.length) return this.#desync();
    // The server decides the positions; if our copy of the rules gives a different ranking, ours is wrong: fetch the real one.
    if (m.rankings && JSON.stringify(m.rankings) !== JSON.stringify(state.rankings)) return this.#desync();
    this.#stopTimer();
    if (!view) return;

    view.setMovable([]);
    await view.animateMove(m.player, m.index, m.from, m.to);
    if (m.captured.length) {
      view.announceCapture(m.player, m.captured);
      await view.animateCaptures(m.captured);
    }
    await view.settle();
    await view.hideDice?.(); // the move is played: the die shrinks away until the next turn
    if (state.phase === PHASE.GAME_OVER) {
      view.showRanks?.(state.rankings);
      await view.showWinner(state.winner);
    } else if (result.position) {
      view.showRanks?.(state.rankings);
      await view.showFinished?.(m.player, result.position); // somebody finished; the others play on
    }
  }

  // A player left the running game: take them out of our copy exactly as the server did, and check we agree on the result.
  async #onLeft(m) {
    const { state, view } = this;
    if (!state.removePlayer(m.player)) return this.#desync();
    const over = state.phase === PHASE.GAME_OVER;
    if (over !== m.over || (over && JSON.stringify(m.rankings) !== JSON.stringify(state.rankings))) return this.#desync();
    this.#stopTimer();
    if (!view) return;
    view.showLeft?.(m.player);
    view.setMovable([]);
    if (over) {
      view.showRanks?.(state.rankings);
      await view.showWinner(state.winner);
    }
  }

  #onTurn(m) {
    const { state, view } = this;
    if (state.phase !== PHASE.END) return this.#desync();
    const extra = state.endTurn();
    if (extra !== m.extra || state.currentPlayer !== m.player) return this.#desync();
    this.#startTimer(m.player, m.timeoutMs, m.receivedAt); // the roll countdown, when a person has to roll
    if (!view) return;
    view.showTurn(m.player, extra);
    view.setRollEnabled(m.player === this.myColor);
  }

  // Our copy no longer matches the server's: ask for the whole state and ignore events until it arrives.
  #desync() {
    if (this.#syncing) return;
    this.#syncing = true;
    this.send({ t: 'sync' });
  }

  async #applySnapshot(m) {
    try {
      this.state.restore(m.snapshot);
    } catch (error) {
      this.onFatal(error);
      return;
    }
    this.seq = m.seq;
    this.#syncing = false;
    this.#waiting = false;
    this.#startTimer(this.state.currentPlayer, this.state.phase === PHASE.GAME_OVER ? null : m.timeoutMs, m.receivedAt);
    if (this.view) {
      await this.view.settle(false);
      this.#present();
    }
  }
}
