// A fake TurnController view: records every call, and can hold animations open until flush().
export class FakeView {
  constructor({ manual = false } = {}) {
    this.manual = manual;
    this.calls = [];
    this.waiters = [];
    this.failOn = null; // method name whose promise should reject
    this.failWith = null;
    this.rollEnabled = null;
    this.movable = [];
    this.interactive = true;
  }

  names() {
    return this.calls.map(([name]) => name);
  }

  count(name) {
    return this.names().filter((n) => n === name).length;
  }

  find(name) {
    return this.calls.find(([n]) => n === name);
  }

  // Resolves every held animation.
  flush() {
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.resolve();
  }

  // Keeps resolving held animations until promise settles (a turn runs several in sequence).
  async finish(promise) {
    let done = false;
    const tracked = promise.finally(() => (done = true));
    while (!done) {
      this.flush();
      await tick();
    }
    return tracked;
  }

  #log(name, ...args) {
    this.calls.push([name, ...args]);
  }

  #animate(name, ...args) {
    this.#log(name, ...args);
    if (this.failOn === name) {
      this.failOn = null;
      return Promise.reject(this.failWith);
    }
    if (!this.manual) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ resolve }));
  }

  showTurn(...a) { this.#log('showTurn', ...a); }
  showFinished(...a) { return this.#animate('showFinished', ...a); }
  showRanks(...a) { this.#log('showRanks', ...a); }
  startTurnTimer(...a) { this.#log('startTurnTimer', ...a); }
  stopTurnTimer() { this.#log('stopTurnTimer'); }
  setRollEnabled(v) { this.rollEnabled = v; this.#log('setRollEnabled', v); }
  setMovable(v, interactive = true) { this.movable = v; this.interactive = interactive; this.#log('setMovable', v); }
  showRollResult(...a) { this.#log('showRollResult', ...a); }
  showPickToken(...a) { this.#log('showPickToken', ...a); }
  showAiPick(...a) { this.#log('showAiPick', ...a); }
  showWaiting(...a) { this.#log('showWaiting', ...a); }
  showNoMoves(...a) { this.#log('showNoMoves', ...a); }
  announceCapture(...a) { this.#log('announceCapture', ...a); }
  showWinner(...a) { return this.#animate('showWinner', ...a); }
  animateRoll(...a) { return this.#animate('animateRoll', ...a); }
  pause(...a) { return this.#animate('pause', ...a); }
  animateMove(...a) { return this.#animate('animateMove', ...a); }
  animateCaptures(...a) { return this.#animate('animateCaptures', ...a); }
  settle(...a) { return this.#animate('settle', ...a); }
}

// Lets queued promise callbacks run.
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));




