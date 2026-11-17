import Phaser from 'phaser';
import { addText } from '../ui/SpriteText.js';

// A picture button with its name underneath (or no name: leave `label` out and make cellH equal to tileH), for the
// splash page. The whole cell is the touch target. It grows slightly under the pointer and dips when pressed, like Button.
export class ImageButton extends Phaser.GameObjects.Container {
  // tileW x tileH is the box the picture is fitted into; cellH is the height of picture plus label. The name is
  // wrapped to labelWrap wide and fills the labelLines lines reserved under the picture.
  constructor(scene, x, y, { textureKey, label, tileW, tileH, cellH, labelFont, labelLines = 1, labelWrap = tileW, onClick }) {
    super(scene, x, y);
    const picture = scene.add.image(0, -cellH / 2 + tileH / 2, textureKey);
    picture.setScale(Math.min(tileW / picture.width, tileH / picture.height));
    this.label = label ? addText(scene, 0, cellH / 2 - (labelFont * 1.3 * labelLines) / 2, label, { fontSize: `${labelFont}px`, color: '#ffffff', align: 'center', wordWrap: { width: labelWrap } }).setOrigin(0.5) : null;
    this.add(this.label ? [picture, this.label] : [picture]);

    this.setSize(tileW, cellH);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => scene.tweens.add({ targets: this, scale: 1.05, duration: 100 }));
    this.on('pointerout', () => scene.tweens.add({ targets: this, scale: 1, duration: 100 }));
    this.on('pointerdown', () => {
      scene.tweens.add({ targets: this, scale: 0.95, duration: 60, yoyo: true });
      onClick?.();
    });
    scene.add.existing(this);
  }
}
