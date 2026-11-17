import Phaser from 'phaser';
import { applyViewport, layout } from './config/layout.js';
import { createGameConfig } from './config/gameConfig.js';
import { onlineSession } from './online/session.js';
import { watchViewport } from './systems/ViewportWatcher.js';
import { readGameArea } from './systems/viewport.js';

// Lay out for the screen we are on before creating the game, then keep it in step on resize/rotate.
const area = readGameArea();
applyViewport(area.w, area.h, area.allowLandscape);
const game = new Phaser.Game(createGameConfig());
watchViewport(game, { getSize: readGameArea });

// Development only: lets browser tests read the layout and inspect scenes. Removed from production builds.
if (import.meta.env.DEV) {
  window.__ludoLayout = layout;
  window.__ludoGame = game;
  window.__ludoSession = onlineSession;
}

