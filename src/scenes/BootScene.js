import Phaser from 'phaser';
import { AVATARS, MENU_BUTTON_IMAGES, SPRITE_FONTS } from '../config/assets.js';

// Loads the picture font and the splash-page button pictures, then hands off to the first real scene.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    for (const { key, png, xml } of SPRITE_FONTS) this.load.bitmapFont(key, png, xml);
    for (const { key, url } of MENU_BUTTON_IMAGES) this.load.image(key, url);
    for (const { key, url } of AVATARS) this.load.image(key, url);
  }

  create() {
    this.scene.start('MenuScene');
  }
}
