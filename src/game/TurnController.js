import { PHASE } from './GameState.js';
import { Cancelled } from './Cancelled.js';

const NO_MOVE_PAUSE_MS = 900;
const MAX_AI_FAILURES = 3;

// Drives one game: roll -> pick a token -> move -> captures -> next turn.
// It knows nothing about Phaser. It talks to a `view` (see below), so it can be unit tested
// with a fake view and reused with any renderer.
//
// Players listed in `computers` play themselves: their turns start on their own, roll, pick a token with
// `chooseMove(state)` and move it, with short pauses so people can follow. The people at the table
// use requestRoll() / requestMove(), which are ignored during a computer's turn.
//
// Input rules: requestRoll() / requestMove() are ignored while an animation sequence is running
// (the lock), when called in the wrong phase, for a computer's turn, or after dispose(). Calling them
// twice is harmless.
//
// The view must provide (animation methods return promises; they may reject with Cancelled):
//   showTurn(player, extra)            setRollEnabled(bool)        setMovable(tokenIndexes)
//   showRollResult(value)  (show a die face without animating, used when resuming)
//   hideDice()  (optional: the die shrinks away once the turn's move is played)
//   animateRoll(value)  -> Promise     showPickToken(player, value)
//   showAiPick(tokenIndex)  (a computer has chosen this token)
//   showNoMoves(player, value, forfeited)  pause(ms) -> Promise
//   animateMove(player, index, from, to) -> Promise
//   announceCapture(player, captured)  animateCaptures(captured) -> Promise
//   settle() -> Promise                showWinner(player) -> Promise|void  (the game is over: show everybody's final position)
//   showFinished(player, position) -> Promise|void  (optional) a player has all tokens home and takes `position`; the game goes on
export class TurnController {
  #locked = false;
  #disposed = false;
  #aiQueued = false;
  #aiFailures = 0;
  #computers;

  constructor(state, view, { rng = Math.random, onError = (e) => console.error(e), computers = [], chooseMove, thinkMs = 700, pickMs = 650, autoSingleMove = false } = {}) {
    if (computers.length > 0 && typeof chooseMove !== 'function') throw new Error('Computer players need a chooseMove function');
    this.state = state;
    this.view = view;
    this.rng = rng;
    this.onError = onError;
    this.chooseMove = chooseMove;
    this.thinkMs = thinkMs; // a number of milliseconds, or a function that gives one (a random wait for each bot turn)
    this.pickMs = pickMs;
    this.autoSingleMove = autoSingleMove; // when a person has only one legal move, play it for them
    this.#computers = new Set(computers);
  }

  get busy() {
    return this.#locked;
  }

  isComputer(player) {
    return this.#computers.has(player);
  }

  // Shows the UI for the state the game is in. Normally that is the start of a turn, but a game can also be
  // resumed mid-turn (for example after the screen was rotated and the scene rebuilt).
  start() {
    const { state, view } = this;
    const player = state.currentPlayer;
    switch (state.phase) {
      case PHASE.MOVE:
        view.showTurn(player, false);
        view.setRollEnabled(false);
        view.showRollResult(state.roll);
        if (this.isComputer(player)) this.#aiQueued = true;
        else if (this.#onlyOneMove()) this.#run(() => true, () => this.#autoPlay());
        else this.#presentMove();
        break;
      case PHASE.END: // the turn's outcome was decided but its animation was cut short
        this.#finishTurn();
        break;
      case PHASE.GAME_OVER:
        this.#run(
          () => true,
          () => view.showWinner(state.winner),
        );
        break;
      default:
        this.#beginTurn(false);
    }
    this.#kickAi();
  }

  // Stops all further work. Pending animations may still resolve, but nothing follows them.
  dispose() {
    this.#disposed = true;
  }

  // Player clicked the die. Resolves true if the click was accepted.
  requestRoll() {
    return this.#run(
      () => this.state.phase === PHASE.ROLL && !this.isComputer(this.state.currentPlayer),
      async () => {
        if (await this.#rollStep()) await this.#humanMoveStep();
      },
    );
  }

  // Player chose a token to move. Resolves true if the choice was accepted.
  requestMove(index) {
    return this.#run(
      () => this.state.phase === PHASE.MOVE && !this.isComputer(this.state.currentPlayer) && this.state.legalMoves().includes(index),
      () => this.#moveStep(index),
    );
  }

  // Rolls and animates. Returns true if there is a move to make, false if the turn was already ended
  // (no legal move, or a forfeited third six).
  async #rollStep() {
    const { state, view } = this;
    view.setRollEnabled(false);
    const value = state.rollDice(this.rng);
    await view.animateRoll(value);
    this.#alive();

    if (state.phase === PHASE.END) {
      view.showNoMoves(state.currentPlayer, value, state.forfeited);
      await view.pause(NO_MOVE_PAUSE_MS);
      this.#alive();
      await view.hideDice?.();
      this.#alive();
      this.#finishTurn();
      return false;
    }
    return true;
  }

  #onlyOneMove() {
    return this.autoSingleMove && this.state.legalMoves().length === 1;
  }

  // After a person's roll: if there is only one thing they could do, do it for them (showing the token first);
  // otherwise let them choose.
  async #humanMoveStep() {
    if (this.#onlyOneMove()) await this.#autoPlay();
    else this.#presentMove();
  }

  async #autoPlay() {
    const [index] = this.state.legalMoves();
    this.view.showAiPick(index);
    await this.view.pause(this.pickMs);
    this.#alive();
    await this.#moveStep(index);
  }

  async #moveStep(index) {
    const { state, view } = this;
    const player = state.currentPlayer;
    view.setMovable([]);

    const { from, to, captured, position } = state.moveToken(index);
    await view.animateMove(player, index, from, to);
    this.#alive();
    if (captured.length) {
      view.announceCapture(player, captured);
      await view.animateCaptures(captured);
      this.#alive();
    }
    await view.settle();
    this.#alive();
    await view.hideDice?.(); // the move is played: the die shrinks away until the next turn
    this.#alive();

    if (state.phase === PHASE.GAME_OVER) {
      await view.showWinner(state.winner);
      return;
    }
    // Somebody got their last token home but others are still playing: announce the position, then play on without them.
    if (position) {
      await view.showFinished?.(player, position);
      this.#alive();
    }
    this.#finishTurn();
  }

  // A computer's whole turn, started by the controller itself.
  #aiTurn() {
    return this.#run(
      () => [PHASE.ROLL, PHASE.MOVE].includes(this.state.phase) && this.isComputer(this.state.currentPlayer),
      async () => {
        const { state, view } = this;
        if (state.phase === PHASE.ROLL) {
          await view.pause(typeof this.thinkMs === 'function' ? this.thinkMs() : this.thinkMs);
          this.#alive();
          if (!(await this.#rollStep())) {
            this.#aiFailures = 0;
            return;
          }
        }
        const index = this.chooseMove(state);
        view.showAiPick(index);
        await view.pause(this.pickMs);
        this.#alive();
        await this.#moveStep(index);
        this.#aiFailures = 0;
      },
    );
  }

  // Starts the next computer turn once nothing else is running.
  #kickAi() {
    if (!this.#aiQueued || this.#locked || this.#disposed) return;
    this.#aiQueued = false;
    this.#aiTurn();
  }

  // Aborts the running sequence if the controller was disposed while it was awaiting.
  #alive() {
    if (this.#disposed) throw new Cancelled();
  }

  // The prompt for a person who has rolled and must pick a token.
  #presentMove() {
    this.view.showPickToken(this.state.currentPlayer, this.state.roll);
    this.view.setMovable(this.state.legalMoves());
  }

  #beginTurn(extra) {
    const { state, view } = this;
    view.showTurn(state.currentPlayer, extra);
    if (this.isComputer(state.currentPlayer)) {
      view.setRollEnabled(false);
      this.#aiQueued = true;
    } else {
      view.setRollEnabled(true);
    }
  }

  #finishTurn() {
    const extra = this.state.endTurn();
    this.#beginTurn(extra);
  }

  // Runs `work` under the input lock if the precondition holds. Always releases the lock, then lets a
  // waiting computer turn start.
  async #run(precondition, work) {
    if (this.#disposed || this.#locked || !precondition()) return false;
    this.#locked = true;
    try {
      await work();
      return true;
    } catch (error) {
      if (error instanceof Cancelled || this.#disposed) return false;
      this.#recover(error);
      return false;
    } finally {
      this.#locked = false;
      this.#kickAi();
    }
  }

  // After an unexpected error, report it and put the UI back into a usable state. A computer that keeps
  // failing is handed over to a person so the game can never freeze.
  #recover(error) {
    try {
      this.onError(error);
      const { state, view } = this;
      if (state.phase === PHASE.END) this.#finishTurn();

      const player = state.currentPlayer;
      const playable = state.phase === PHASE.ROLL || state.phase === PHASE.MOVE;
      if (this.isComputer(player) && playable) {
        if (++this.#aiFailures >= MAX_AI_FAILURES) {
          this.#computers.delete(player);
          this.#aiFailures = 0;
        } else {
          this.#aiQueued = true;
          return;
        }
      }
      // A person is (now) in charge of this turn.
      view.setRollEnabled(state.phase === PHASE.ROLL);
      if (state.phase === PHASE.MOVE) this.#presentMove();
      else view.setMovable([]);
    } catch (secondary) {
      this.onError(secondary);
    }
  }
}
