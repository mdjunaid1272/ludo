import Phaser from 'phaser';
import { BUTTON_PICTURES } from '../config/assets.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

// How tall the picture of a Back / Cancel / Reset defaults button is drawn, against the height of the button (the pictures have leaves and
// stones round them), and the widest it may get against the button's width.
const PICTURE_HEIGHT = 1.5;
const PICTURE_MAX_WIDTH = 1.1;

// A rounded, clickable button with hover/press feedback. Can be re-labelled, re-coloured
// and disabled after creation. A button labelled Back, Cancel or Reset defaults (no sublabel) shows that button's picture
// (img/buttons) instead of the drawn button and the text; without the picture it is drawn as usual.
export class Button extends Phaser.GameObjects.Container {
  // `textColor` is a CSS colour (use dark text on light buttons); `outlineColor` replaces the white outline,
  // for example to mark the option that was chosen last time.
  constructor(scene, x, y, { label, sublabel = '', color, width = 440, height = 84, fontSize = 30, textColor = UI.text, outlineColor = 0xffffff, onClick }) {
    super(scene, x, y);
    this.owner = scene; // the scene the button lives in
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
    this.sublabel = Boolean(sublabel);
    this.picture = null;
    this.showPicture(label);
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

  // Shows the picture that goes with `label` (if there is one), or the drawn button and text when there is not.
  showPicture(label) {
    const key = this.sublabel ? null : BUTTON_PICTURES[String(label).trim().toLowerCase()];
    const textures = this.owner.textures;
    this.picture?.destroy();
    this.picture = null;
    if (key && textures?.exists?.(key)) {
      const picture = this.owner.add.image(0, 0, key);
      const aspect = picture.width / picture.height;
      let h = this.h * PICTURE_HEIGHT;
      if (h * aspect > this.w * PICTURE_MAX_WIDTH) h = (this.w * PICTURE_MAX_WIDTH) / aspect;
      picture.setDisplaySize(h * aspect, h).setAlpha(this.enabled ? 1 : 0.5);
      this.add(picture);
      this.picture = picture;
    }
    this.title.setVisible(!this.picture);
  }

  drawBg() {
    if (this.picture) {
      this.bg.clear(); // the picture is the whole button
      return;
    }
    const { w, h } = this;
    const r = Math.min(20, h / 3);
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.35).fillRoundedRect(-w / 2, -h / 2 + 5, w, h, r);
    this.bg.fillStyle(this.enabled ? this.color : UI.neutral, this.enabled ? 1 : 0.6).fillRoundedRect(-w / 2, -h / 2, w, h, r);
    this.bg.lineStyle(3, this.outlineColor, this.enabled ? 0.9 : 0.35).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }

  setLabel(text) {
    this.title.setText(text);
    this.showPicture(text);
    this.drawBg();
    return this;
  }

  setColor(color) {
    this.color = color;
    this.drawBg();
    return this;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.picture?.setAlpha(enabled ? 1 : 0.5);
    this.drawBg();
    return this;
  }
}
