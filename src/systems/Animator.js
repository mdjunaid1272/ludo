import { Cancelled } from '../game/Cancelled.js';

// Promise-based tweens and delays for one scene. Every pending animation is tracked, and when
// the scene shuts down (restart, menu, destroy) they all reject with Cancelled, so no awaiting
// code runs against a dead scene.
export class Animator {
  #pending = new Set();
  #cancelled = false;

  constructor(scene) {
    this.scene = scene;
    scene.events.once('shutdown', () => this.cancel());
    scene.events.once('destroy', () => this.cancel());
  }

  get cancelled() {
    return this.#cancelled;
  }

  #track(start) {
    return new Promise((resolve, reject) => {
      if (this.#cancelled) {
        reject(new Cancelled());
        return;
      }
      const entry = { reject };
      this.#pending.add(entry);
      start(() => {
        if (!this.#pending.delete(entry)) return; // already cancelled
        resolve();
      });
    });
  }

  tween(targets, props, duration, ease = 'Sine.easeInOut') {
    return this.#track((done) => this.scene.tweens.add({ targets, ...props, duration, ease, onComplete: done }));
  }

  delay(ms) {
    return this.#track((done) => this.scene.time.delayedCall(ms, done));
  }

  cancel() {
    this.#cancelled = true;
    const entries = [...this.#pending];
    this.#pending.clear();
    for (const entry of entries) entry.reject(new Cancelled());
  }
}
