import Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/objects/Button.js';
import { BUTTON_PICTURES } from '../src/config/assets.js';

vi.mock('../src/ui/SpriteText.js', () => ({
  addText: () => ({ visible: true, setOrigin() { return this; }, setText(t) { this.text = t; return this; }, setVisible(v) { this.visible = v; return this; } }),
}));

// The Phaser stand-in for tests has an empty Container; give it what a button needs.
Object.assign(Phaser.GameObjects.Container.prototype, {
  add(items) { (this.items ??= []).push(...[].concat(items)); },
  setSize() { return this; },
  setInteractive() { return this; },
  on(name, fn) { (this.handlers ??= {})[name] = fn; return this; },
});

function fakeScene(keys = Object.values(BUTTON_PICTURES)) {
  const images = [];
  const scene = {
    textures: { exists: (key) => keys.includes(key) },
    tweens: { add() {} },
    add: {
      graphics: () => ({ clear() { this.cleared = true; return this; }, fillStyle() { return this; }, fillRoundedRect() { return this; }, lineStyle() { return this; }, strokeRoundedRect() { return this; } }),
      image: (_x, _y, key) => {
        const image = {
          key, width: 640, height: 253, destroyed: false, alpha: 1,
          setDisplaySize(w, h) { this.size = [w, h]; return this; },
          setAlpha(a) { this.alpha = a; return this; },
          destroy() { this.destroyed = true; },
        };
        images.push(image);
        return image;
      },
      existing() {},
    },
  };
  return { scene, images };
}

const make = (scene, label, extra = {}) => new Button(scene, 0, 0, { label, color: 1, width: 440, height: 84, onClick: extra.onClick, ...extra });

describe('buttons labelled Back, Cancel or Reset defaults', () => {
  it('know their pictures', () => {
    expect(BUTTON_PICTURES).toEqual({ back: 'btn-back', cancel: 'btn-cancel', 'reset defaults': 'btn-reset' });
  });

  it('show the picture instead of the drawn button and the text', () => {
    for (const [label, key] of [['Back', 'btn-back'], ['Cancel', 'btn-cancel'], ['Reset defaults', 'btn-reset']]) {
      const { scene, images } = fakeScene();
      const button = make(scene, label);
      expect(images.map((i) => i.key)).toEqual([key]);
      expect(button.title.visible).toBe(false);
      expect(button.bg.cleared).toBe(true);
    }
  });

  it('draw the picture with the right proportions, taller than the button and never much wider than it', () => {
    const { scene, images } = fakeScene();
    make(scene, 'Back', { width: 440, height: 84 });
    const [w, h] = images[0].size;
    expect(w / h).toBeCloseTo(640 / 253, 5);
    expect(h).toBeCloseTo(84 * 1.5, 5);
    const narrow = fakeScene();
    make(narrow.scene, 'Back', { width: 100, height: 84 });
    expect(narrow.images[0].size[0]).toBeCloseTo(110, 5); // no wider than 1.1 times the button
  });

  it('still call onClick when tapped', () => {
    const { scene } = fakeScene();
    const onClick = vi.fn();
    const button = make(scene, 'Cancel', { onClick });
    button.handlers.pointerdown();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('are dimmed while disabled', () => {
    const { scene, images } = fakeScene();
    const button = make(scene, 'Back');
    button.setEnabled(false);
    expect(images[0].alpha).toBeLessThan(1);
    button.setEnabled(true);
    expect(images[0].alpha).toBe(1);
  });

  it('change picture (or go back to the drawn button) when they are re-labelled', () => {
    const { scene, images } = fakeScene();
    const button = make(scene, 'Cancel');
    button.setLabel('Back');
    expect(images[0].destroyed).toBe(true);
    expect(images.at(-1).key).toBe('btn-back');
    button.setLabel('Play');
    expect(images.at(-1).destroyed).toBe(true);
    expect(button.picture).toBeNull();
    expect(button.title.visible).toBe(true);
  });

  it('are drawn as plain buttons when their picture is not loaded', () => {
    const { scene, images } = fakeScene([]);
    const button = make(scene, 'Back');
    expect(images).toHaveLength(0);
    expect(button.title.visible).toBe(true);
  });

  it('leave other labels alone, and buttons with a second line of text', () => {
    const { scene, images } = fakeScene();
    make(scene, 'Play');
    make(scene, 'Back', { sublabel: 'to the menu' });
    expect(images).toHaveLength(0);
  });
});
