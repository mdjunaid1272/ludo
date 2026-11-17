import { describe, it, expect } from 'vitest';
import { Animator } from '../src/systems/Animator.js';
import { Cancelled } from '../src/game/Cancelled.js';
import { tick } from './fakeView.js';

function fakeScene() {
  const listeners = {};
  return {
    listeners,
    tweenConfigs: [],
    timers: [],
    events: { once: (name, fn) => (listeners[name] = fn) },
    tweens: { add(config) { this.owner.tweenConfigs.push(config); } },
    time: { delayedCall(ms, fn) { this.owner.timers.push({ ms, fn }); } },
    init() { this.tweens.owner = this; this.time.owner = this; return this; },
  };
}
const make = () => {
  const scene = fakeScene().init();
  return { scene, animator: new Animator(scene) };
};

describe('Animator', () => {
  it('resolves a tween when it completes, and passes the tween settings through', async () => {
    const { scene, animator } = make();
    const target = {};
    const done = animator.tween(target, { x: 5 }, 120);
    expect(scene.tweenConfigs[0]).toMatchObject({ targets: target, x: 5, duration: 120 });
    scene.tweenConfigs[0].onComplete();
    await expect(done).resolves.toBeUndefined();
  });

  it('resolves a delay when its timer fires', async () => {
    const { scene, animator } = make();
    const done = animator.delay(300);
    expect(scene.timers[0].ms).toBe(300);
    scene.timers[0].fn();
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects every pending animation with Cancelled when cancelled', async () => {
    const { animator } = make();
    const a = animator.tween({}, {}, 100);
    const b = animator.delay(100);
    animator.cancel();
    await expect(a).rejects.toBeInstanceOf(Cancelled);
    await expect(b).rejects.toBeInstanceOf(Cancelled);
    expect(animator.cancelled).toBe(true);
  });

  it('rejects new animations immediately after cancelling', async () => {
    const { scene, animator } = make();
    animator.cancel();
    await expect(animator.delay(10)).rejects.toBeInstanceOf(Cancelled);
    expect(scene.timers).toHaveLength(0);
  });

  it('cancels automatically on scene shutdown and on destroy', async () => {
    for (const event of ['shutdown', 'destroy']) {
      const { scene, animator } = make();
      const pending = animator.delay(50);
      scene.listeners[event]();
      await expect(pending).rejects.toBeInstanceOf(Cancelled);
    }
  });

  it('ignores a tween completing after cancellation (no double settle, no throw)', async () => {
    const { scene, animator } = make();
    const pending = animator.tween({}, {}, 100);
    animator.cancel();
    await expect(pending).rejects.toBeInstanceOf(Cancelled);
    expect(() => scene.tweenConfigs[0].onComplete()).not.toThrow();
    await tick();
  });
});
