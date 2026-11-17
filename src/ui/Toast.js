import { layout } from '../config/layout.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 900; // above the game, below dialogs

// A small message pill at the bottom of the screen. show() disappears after a moment; hold() stays until
// clear() (used for "Reconnecting..."). A new message replaces the previous one.
export class Toast {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.timer = null;
  }

  show(text, ms = 2800) {
    this.#render(text);
    this.timer = this.scene.time.delayedCall(ms, () => this.clear());
  }

  hold(text) {
    this.#render(text);
  }

  clear() {
    if (this.timer) this.timer.remove(false);
    this.timer = null;
    for (const item of this.items) item.destroy();
    this.items = [];
  }

  #render(text) {
    this.clear();
    const font = layout.ui(20, 13);
    const label = addText(this.scene, layout.width / 2, 0, text, { fontSize: `${font}px`, color: '#ffffff', align: 'center', wordWrap: { width: layout.width - 80 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const w = Math.min(layout.width - 40, label.width + 40);
    const h = label.height + 24;
    const y = layout.height - 30 - h / 2;
    label.setY(y);
    const bg = this.scene.add.graphics().setDepth(DEPTH);
    bg.fillStyle(0x000000, 0.8).fillRoundedRect(layout.width / 2 - w / 2, y - h / 2, w, h, 16);
    bg.lineStyle(2, UI.accent, 0.9).strokeRoundedRect(layout.width / 2 - w / 2, y - h / 2, w, h, 16);
    this.items = [bg, label];
  }
}
