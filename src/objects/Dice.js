import Phaser from 'phaser';
import { DICE_SHEET } from '../config/assets.js';
import { layout, MIN_TOUCH } from '../config/layout.js';

const SIZE = 72; // drawn at this size, then scaled to the size the layout asks for
// Pip positions per face, as fractions of the die size (from the die's top-left).
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

const HIDE_MS = 260; // how long the die takes to shrink away once the turn's move is played
const APPEAR_MS = 420; // how long the die takes to grow to its size at the start of a turn
const PICTURE = SIZE * 1.02; // the face picture's size (the die in it fills 118 of its 128 pixels, so the die is a little under SIZE)

// A clickable die, drawn around its centre so it can spin and bounce. Emits 'click'.
// The faces are the pictures in img/elements/dice-sheet.png (without them the die is drawn with shapes). A ring in the current player's
// colour stands round it (thicker while the die is waiting for a roll), and a pulse shows when it is waiting for a roll.
export class Dice extends Phaser.Events.EventEmitter {
  constructor(scene, animator, x, y, size = SIZE) {
    super();
    this.scene = scene;
    this.animator = animator;
    this.base = size / SIZE; // resting scale
    this.value = 6;
    this.ownerColor = 0x2b2f3a;
    this.ready = false;
    this.pulse = null;
    this.appearTween = null;
    this.appearing = false;
    // The drawing (the ring and shadow, or the whole die without the pictures) and the face picture move together in one container.
    this.art = scene.add.graphics();
    this.face = scene.textures?.exists?.(DICE_SHEET.key) ? scene.add.image(0, 0, DICE_SHEET.key, this.value - 1).setDisplaySize(PICTURE, PICTURE) : null;
    this.gfx = scene.add.container(x, y, this.face ? [this.art, this.face] : [this.art]).setDepth(6).setScale(this.base);
    const hitSize = Math.max(size + 12, MIN_TOUCH / layout.scale);
    this.hit = scene.add.rectangle(x, y, hitSize, hitSize, 0x000000, 0).setInteractive({ useHandCursor: true }).setDepth(7);
    this.hit.on('pointerdown', () => this.emit('click'));
    this.draw();
  }

  draw() {
    const half = SIZE / 2;
    const g = this.art.clear();
    if (this.face) {
      this.face.setFrame(this.value - 1);
      // a soft shadow under the die, and the ring in the player's colour round it
      g.fillStyle(0x000000, 0.3).fillRoundedRect(-half + 3, -half + 7, SIZE, SIZE, 16);
      g.lineStyle(this.ready ? 7 : 4, this.ownerColor, 1).strokeRoundedRect(-half - 3, -half - 3, SIZE + 6, SIZE + 6, 18);
      return;
    }
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-half + 3, -half + 6, SIZE, SIZE, 14);
    g.fillStyle(0xffffff, 1).fillRoundedRect(-half, -half, SIZE, SIZE, 14);
    g.fillStyle(0xe3e8ef, 1).fillRoundedRect(-half + 4, half - 14, SIZE - 8, 10, 6); // soft underside
    // The frame is always the current player's colour; it is thicker (and the die pulses) while the die is waiting for a roll.
    g.lineStyle(this.ready ? 7 : 4, this.ownerColor, 1).strokeRoundedRect(-half, -half, SIZE, SIZE, 14);
    g.fillStyle(0x222222, 1);
    for (const [fx, fy] of PIPS[this.value]) g.fillCircle((fx - 0.5) * SIZE, (fy - 0.5) * SIZE, SIZE * 0.08);
  }

  // Shows a face immediately, without the roll animation.
  setValue(value) {
    this.value = value;
    this.draw();
  }

  setOwner(color) {
    this.ownerColor = color;
    this.draw();
  }

  // Shakes through random faces, then settles on `value` with a little bounce.
  async showRoll(value) {
    this.appearTween?.stop(); // a roll right after the turn began cuts the growing short
    this.appearTween = null;
    this.appearing = false;
    this.gfx.setScale(this.base * 1.12);
    for (let i = 0; i < 8; i++) {
      this.value = 1 + Math.floor(Math.random() * 6);
      this.gfx.setAngle(Phaser.Math.Between(-18, 18));
      this.draw();
      await this.animator.delay(60);
    }
    this.value = value;
    this.gfx.setAngle(0);
    this.draw();
    await this.animator.tween(this.gfx, { scale: this.base * 1.25, yoyo: true }, 90);
    this.gfx.setScale(this.base);
  }

  // Moves the die (and its touch area) to (x, y): gliding there, or at once with glide = false.
  moveTo(x, y, glide = true) {
    if (this.gfx.x === x && this.gfx.y === y) return;
    this.moveTween?.stop();
    this.moveTween = null;
    if (!glide) {
      this.gfx.setPosition(x, y);
      this.hit.setPosition(x, y);
      return;
    }
    this.moveTween = this.scene.tweens.add({ targets: [this.gfx, this.hit], x, y, duration: 260, ease: 'Sine.easeInOut' });
  }

  // A new turn: the die appears at (x, y) growing from nothing to its size, with a little overshoot.
  appear(x, y) {
    this.moveTween?.stop();
    this.moveTween = null;
    this.appearTween?.stop();
    this.pulse?.stop();
    this.pulse = null;
    this.gfx.setPosition(x, y).setAngle(0).setScale(0);
    this.hit.setPosition(x, y);
    this.appearing = true;
    this.appearTween = this.scene.tweens.add({
      targets: this.gfx,
      scale: this.base,
      duration: APPEAR_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.appearing = false;
        this.appearTween = null;
        if (this.ready) this.startPulse(); // it was made ready while it was still growing
      },
    });
  }

  // Shrinks from its size to nothing. Resolves when it is gone.
  hide() {
    this.moveTween?.stop();
    this.moveTween = null;
    this.appearTween?.stop();
    this.appearTween = null;
    this.appearing = false;
    this.pulse?.stop();
    this.pulse = null;
    this.hit.disableInteractive();
    return this.animator.tween(this.gfx, { scale: 0 }, HIDE_MS, 'Back.easeIn');
  }

  startPulse() {
    this.pulse?.stop();
    this.pulse = this.scene.tweens.add({ targets: this.gfx, scale: this.base * 1.08, duration: 500, yoyo: true, repeat: -1 });
  }

  // Enables or disables clicking; while enabled the die glows and pulses (once it has finished appearing).
  setReady(ready) {
    this.ready = ready;
    this.pulse?.stop();
    this.pulse = null;
    if (ready) {
      this.hit.setInteractive({ useHandCursor: true });
      if (!this.appearing) this.startPulse();
    } else {
      this.hit.disableInteractive();
      if (!this.appearing) this.gfx.setScale(this.base);
    }
    this.draw();
  }
}


