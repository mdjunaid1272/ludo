import { describe, expect, it } from 'vitest';
import { Dice } from '../src/objects/Dice.js';

// A stand-in for a scene: records the tweens the die asks for, and lets a test finish them.
function fakeScene() {
  const tweens = [];
  const object = () => {
    const o = {
      x: 0, y: 0, scale: 1, angle: 0,
      setDepth() { return this; },
      setScale(s) { this.scale = s; return this; },
      setAngle(a) { this.angle = a; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setInteractive() { this.interactive = true; return this; },
      disableInteractive() { this.interactive = false; return this; },
      setDisplaySize() { return this; },
      setFrame() { return this; },
      on() { return this; },
      clear() { return this; },
      fillStyle() { return this; }, fillRoundedRect() { return this; }, lineStyle() { return this; }, strokeRoundedRect() { return this; }, fillCircle() { return this; },
    };
    return o;
  };
  const scene = {
    add: { graphics: object, image: object, container: object, rectangle: object },
    tweens: {
      add(config) {
        const tween = { config, stopped: false, stop() { this.stopped = true; }, finish() { for (const t of [].concat(config.targets)) t.scale = config.scale ?? t.scale; config.onComplete?.(); } };
        tweens.push(tween);
        return tween;
      },
    },
  };
  return { scene, tweens };
}

const makeDie = () => {
  const { scene, tweens } = fakeScene();
  const die = new Dice(scene, { tween: async () => {}, delay: async () => {} }, 100, 200, 72);
  return { die, tweens };
};

describe('the die at the start of a turn', () => {
  it('grows from nothing to its size, at the player\'s spot', () => {
    const { die, tweens } = makeDie();
    die.appear(300, 700);
    expect([die.gfx.x, die.gfx.y, die.hit.x, die.hit.y]).toEqual([300, 700, 300, 700]);
    expect(die.gfx.scale).toBe(0);
    expect(tweens).toHaveLength(1);
    expect(tweens[0].config).toMatchObject({ scale: die.base, ease: 'Back.easeOut' }); // overshoots a little, then settles
    tweens[0].finish();
    expect(die.gfx.scale).toBe(die.base);
    expect(die.appearing).toBe(false);
  });

  it('starts again from nothing on every turn, even when the spot is the same', () => {
    const { die, tweens } = makeDie();
    die.appear(300, 700);
    tweens[0].finish();
    die.appear(300, 700);
    expect(die.gfx.scale).toBe(0);
    expect(tweens).toHaveLength(2);
  });

  it('cuts the earlier growing short when a new turn comes', () => {
    const { die, tweens } = makeDie();
    die.appear(300, 700);
    die.appear(50, 60);
    expect(tweens[0].stopped).toBe(true);
    expect([die.gfx.x, die.gfx.y]).toEqual([50, 60]);
  });

  it('pulses only after it has finished growing, if it was made ready meanwhile', () => {
    const { die, tweens } = makeDie();
    die.appear(300, 700);
    die.setReady(true);
    expect(tweens).toHaveLength(1); // no pulse yet: the growing is not interrupted
    expect(die.gfx.scale).toBe(0);
    tweens[0].finish();
    expect(tweens).toHaveLength(2);
    expect(tweens[1].config).toMatchObject({ repeat: -1, yoyo: true }); // the pulse
  });

  it('pulses at once when it is already full size', () => {
    const { die, tweens } = makeDie();
    die.setReady(true);
    expect(tweens).toHaveLength(1);
    expect(tweens[0].config.repeat).toBe(-1);
    die.setReady(false);
    expect(tweens[0].stopped).toBe(true);
    expect(die.gfx.scale).toBe(die.base);
  });

  it('is not shrunk back by being made not ready while it is growing', () => {
    const { die } = makeDie();
    die.appear(300, 700);
    die.setReady(false);
    expect(die.gfx.scale).toBe(0); // still growing from nothing
  });

  it('stops growing when a roll starts straight away', async () => {
    const { die, tweens } = makeDie();
    die.appear(300, 700);
    await die.showRoll(4);
    expect(tweens[0].stopped).toBe(true);
    expect(die.appearing).toBe(false);
    expect(die.value).toBe(4);
  });
});
