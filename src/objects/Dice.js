import Phaser from 'phaser';
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

// A clickable die, drawn around its centre so it can spin and bounce. Emits 'click'.
// The border takes the current player's colour; a pulse shows when it is waiting for a roll.
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
    this.gfx = scene.add.graphics({ x, y }).setDepth(6).setScale(this.base);
    const hitSize = Math.max(size + 12, MIN_TOUCH / layout.scale);
    this.hit = scene.add.rectangle(x, y, hitSize, hitSize, 0x000000, 0).setInteractive({ useHandCursor: true }).setDepth(7);
    this.hit.on('pointerdown', () => this.emit('click'));
    this.draw();
  }

  draw() {
    const half = SIZE / 2;
    const g = this.gfx.clear();
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

  // Enables or disables clicking; while enabled the die glows and pulses.
  setReady(ready) {
    this.ready = ready;
    this.pulse?.stop();
    this.pulse = null;
    if (ready) {
      this.hit.setInteractive({ useHandCursor: true });
      this.pulse = this.scene.tweens.add({ targets: this.gfx, scale: this.base * 1.08, duration: 500, yoyo: true, repeat: -1 });
    } else {
      this.hit.disableInteractive();
      this.gfx.setScale(this.base);
    }
    this.draw();
  }
}


