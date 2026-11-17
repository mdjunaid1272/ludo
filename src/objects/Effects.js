import { COLORS, UI_DEPTH } from '../config/constants.js';
import { layout } from '../config/layout.js';

const CONFETTI_COLORS = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, 0xffffff];

// Short visual effects. Fire-and-forget objects clean themselves up when their tween ends, or
// with the scene on shutdown.
export class Effects {
  constructor(scene) {
    this.scene = scene;
  }

  // An expanding ring, used where a capture happens.
  burst(x, y, color) {
    for (const delay of [0, 120]) {
      const ring = this.scene.add.circle(x, y, 14).setStrokeStyle(5, color).setDepth(UI_DEPTH.effect).setAlpha(0.9);
      this.scene.tweens.add({
        targets: ring,
        scale: 3.2,
        alpha: 0,
        delay,
        duration: 480,
        onComplete: () => ring.destroy(),
      });
    }
  }

  shake() {
    this.scene.cameras.main.shake(140, 0.004);
  }

  // Confetti falling across the screen.
  confetti(count = 80) {
    for (let i = 0; i < count; i++) {
      const piece = this.scene.add
        .rectangle(Math.random() * layout.width, -20 - Math.random() * 200, 8 + Math.random() * 8, 12 + Math.random() * 8, CONFETTI_COLORS[i % CONFETTI_COLORS.length])
        .setDepth(UI_DEPTH.effect)
        .setAngle(Math.random() * 360);
      this.scene.tweens.add({
        targets: piece,
        y: layout.height + 40,
        x: piece.x + (Math.random() - 0.5) * 200,
        angle: piece.angle + 360 * (Math.random() > 0.5 ? 1 : -1),
        duration: 1800 + Math.random() * 1800,
        ease: 'Sine.easeIn',
        onComplete: () => piece.destroy(),
      });
    }
  }
}

