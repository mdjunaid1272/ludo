import Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { ImageButton } from '../src/objects/ImageButton.js';

// The Phaser stand-in for tests has an empty Container; give it what a button needs.
const Container = Phaser.GameObjects.Container;
Object.assign(Container.prototype, {
  add(items) { this.items = [].concat(items); },
  setSize() { return this; },
  setInteractive() { return this; },
  setAlpha(a) { this.alpha = a; return this; },
  on(name, fn) { (this.handlers ??= {})[name] = fn; return this; },
});

function fakeScene() {
  const tweens = [];
  return {
    tweens: { add: (config) => tweens.push(config) },
    add: {
      image: () => ({ width: 256, height: 252, setScale() { return this; } }),
      existing() {},
    },
    tweenLog: tweens,
  };
}

describe('ImageButton (a picture you can tap)', () => {
  it('calls onClick when tapped, with a little dip', () => {
    const scene = fakeScene();
    const onClick = vi.fn();
    const button = new ImageButton(scene, 10, 20, { textureKey: 'btn-menu', tileW: 80, tileH: 80, cellH: 80, onClick });
    button.handlers.pointerdown();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(scene.tweenLog.at(-1)).toMatchObject({ scale: 0.95, yoyo: true });
  });

  it('is dimmed and does nothing while disabled, and works again once enabled', () => {
    const scene = fakeScene();
    const onClick = vi.fn();
    const button = new ImageButton(scene, 10, 20, { textureKey: 'btn-restart', tileW: 80, tileH: 80, cellH: 80, onClick });
    button.setEnabled(false);
    expect(button.alpha).toBeLessThan(1);
    const before = scene.tweenLog.length;
    button.handlers.pointerdown();
    button.handlers.pointerover();
    expect(onClick).not.toHaveBeenCalled();
    expect(scene.tweenLog.length).toBe(before); // no dip, no grow
    button.setEnabled(true);
    expect(button.alpha).toBe(1);
    button.handlers.pointerdown();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
