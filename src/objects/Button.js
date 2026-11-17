import Phaser from 'phaser';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

// A rounded, clickable button with hover/press feedback. Can be re-labelled, re-coloured
// and disabled after creation.
export class Button extends Phaser.GameObjects.Container {
  // `textColor` is a CSS colour (use dark text on light buttons); `outlineColor` replaces the white outline,
  // for example to mark the option that was chosen last time.
  constructor(scene, x, y, { label, sublabel = '', color, width = 440, height = 84, fontSize = 30, textColor = UI.text, outlineColor = 0xffffff, onClick }) {
    super(scene, x, y);
    this.w = width;
    this.h = height;
    this.color = color;
    this.outlineColor = outlineColor;
    this.enabled = true;

    this.bg = scene.add.graphics();
    this.title = addText(scene, 0, sublabel ? -height * 0.14 : 0, label, { fontSize: `${fontSize}px`, color: textColor }).setOrigin(0.5);
    this.add([this.bg, this.title]);
    if (sublabel) {
      this.add(addText(scene, 0, height * 0.26, sublabel, { fontSize: `${Math.max(12, Math.round(fontSize * 0.55))}px`, color: '#ffffffcc' }).setOrigin(0.5));
    }
    this.drawBg();

    this.setSize(width, height);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.enabled && scene.tweens.add({ targets: this, scale: 1.05, duration: 100 }));
    this.on('pointerout', () => scene.tweens.add({ targets: this, scale: 1, duration: 100 }));
    this.on('pointerdown', () => {
      if (!this.enabled) return;
      scene.tweens.add({ targets: this, scale: 0.97, duration: 60, yoyo: true });
      onClick?.();
    });
    scene.add.existing(this);
  }

  drawBg() {
    const { w, h } = this;
    const r = Math.min(20, h / 3);
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.35).fillRoundedRect(-w / 2, -h / 2 + 5, w, h, r);
    this.bg.fillStyle(this.enabled ? this.color : UI.neutral, this.enabled ? 1 : 0.6).fillRoundedRect(-w / 2, -h / 2, w, h, r);
    this.bg.lineStyle(3, this.outlineColor, this.enabled ? 0.9 : 0.35).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }

  setLabel(text) {
    this.title.setText(text);
    return this;
  }

  setColor(color) {
    this.color = color;
    this.drawBg();
    return this;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.drawBg();
    return this;
  }
}
