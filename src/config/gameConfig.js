import Phaser from 'phaser';
import { COLORS } from './constants.js';
import { layout } from './layout.js';
import { BootScene } from '../scenes/BootScene.js';
import { MenuScene } from '../scenes/MenuScene.js';
import { GameScene } from '../scenes/GameScene.js';
import { SettingsScene } from '../scenes/SettingsScene.js';
import { OnlineScene } from '../scenes/OnlineScene.js';

// Built after the layout has been computed for the current screen (see main.js).
export const createGameConfig = () => ({
  type: Phaser.AUTO,
  parent: 'game',
  width: layout.width,
  height: layout.height,
  backgroundColor: COLORS.background,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, SettingsScene, OnlineScene, GameScene],
});
