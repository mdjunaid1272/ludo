import { CELL, UI_DEPTH } from '../config/constants.js';
import { UI } from '../ui/theme.js';

// Markers on the cells that movable tokens can reach, so players see where a click will take them.
export class MoveHints {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map();
  }

  // hints: [{ key, x, y, color }]
  show(hints) {
    this.clear();
    for (const { key, x, y, color } of hints) {
      const fill = this.scene.add.circle(0, 0, CELL * 0.4, color, 0.28);
      const ring = this.scene.add.circle(0, 0, CELL * 0.4).setStrokeStyle(3, UI.accent, 0.9);
      const marker = this.scene.add.container(x, y, [fill, ring]).setDepth(UI_DEPTH.marker);
      const tween = this.scene.tweens.add({ targets: marker, alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
      this.markers.set(key, { marker, tween });
    }
  }

  // Emphasises one marker, for example while its token is hovered.
  highlight(key, on) {
    const entry = this.markers.get(key);
    if (!entry) return;
    entry.tween.stop();
    entry.marker.setAlpha(1).setScale(on ? 1.25 : 1);
    if (!on) {
      entry.tween = this.scene.tweens.add({ targets: entry.marker, alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
    }
  }

  clear() {
    for (const { marker, tween } of this.markers.values()) {
      tween.stop();
      marker.destroy();
    }
    this.markers.clear();
  }
}
