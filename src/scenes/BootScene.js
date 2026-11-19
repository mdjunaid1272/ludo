import Phaser from 'phaser';
import { AVATARS, DICE_SHEET, ELEMENT_IMAGES, MENU_BUTTON_IMAGES, SPRITE_FONTS } from '../config/assets.js';

// Loads the picture font and the splash-page button pictures, then hands off to the first real scene.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    for (const { key, png, xml } of SPRITE_FONTS) this.load.bitmapFont(key, png, xml);
    for (const { key, url } of MENU_BUTTON_IMAGES) this.load.image(key, url);
    for (const { key, url } of AVATARS) this.load.image(key, url);
    for (const { key, url } of ELEMENT_IMAGES) this.load.image(key, url);
    this.load.spritesheet(DICE_SHEET.key, DICE_SHEET.url, { frameWidth: DICE_SHEET.frameWidth, frameHeight: DICE_SHEET.frameHeight });
  }

  create() {
    this.scene.start('MenuScene');
  }
}
