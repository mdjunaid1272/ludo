import { layout } from '../config/layout.js';
import { Button } from '../objects/Button.js';
import { ImageButton } from '../objects/ImageButton.js';
import { addText } from './SpriteText.js';
import { UI, cssColor } from './theme.js';

// The Restart and Menu buttons are pictures (img/buttons/restart-button.png and menu-button.png): square, as tall as the old buttons were
// wide allows (a little taller than they were). Without the picture they are the plain text buttons. `spot` is the layout's { x, y, w, h }.
function iconButton(scene, textureKey, spot, onClick, shiftX = 0) {
  if (!scene.textures?.exists?.(textureKey)) return null;
  const side = Math.min(spot.w, spot.h * ICON_TO_PILL);
  return new ImageButton(scene, spot.x + shiftX, spot.y, { textureKey, tileW: side, tileH: side, cellH: side, onClick });
}
const ICON_SHIFT = 20; // Restart is moved this far left, and Menu this far right (layout pixels), further out towards the edges
const ICON_TO_PILL = 1.47; // the icon's side, against the height of the button it replaces

// Heads-up display: title, Restart/Menu buttons and the status line.
// Everything is placed from the layout, so it adapts to portrait and landscape screens.
export class Hud {
  // `restartEnabled` false greys the Restart button out (an online game cannot be restarted by one player). `onChat` (online
  // games) puts a Chat button in Restart's place instead: it opens the quick chat / reactions panel.
  constructor(scene, { onRestart, onMenu, restartEnabled = true, onChat = null }) {
    const { hud } = layout;
    addText(scene, hud.title.x, hud.title.y, 'LUDO', { fontSize: `${hud.title.font}px`, color: '#ffffff' }).setOrigin(0.5);
    if (onChat) {
      this.chatButton = new Button(scene, hud.restart.x, hud.restart.y, { label: 'Chat', color: UI.info, width: hud.restart.w, height: hud.restart.h, fontSize: hud.restart.font, onClick: onChat });
    } else {
      this.restartButton = iconButton(scene, 'btn-restart', hud.restart, onRestart, -ICON_SHIFT)
        ?? new Button(scene, hud.restart.x, hud.restart.y, { label: 'Restart', color: UI.neutral, width: hud.restart.w, height: hud.restart.h, fontSize: hud.restart.font, onClick: onRestart });
      this.restartButton.setEnabled(restartEnabled);
    }
    this.menuButton = iconButton(scene, 'btn-menu', hud.menu, onMenu, ICON_SHIFT)
      ?? new Button(scene, hud.menu.x, hud.menu.y, { label: 'Menu', color: UI.neutral, width: hud.menu.w, height: hud.menu.h, fontSize: hud.menu.font, onClick: onMenu });

    this.status = addText(scene, hud.status.x, hud.status.y, '', { fontSize: `${hud.status.font}px`, align: 'center', wordWrap: { width: hud.status.w } }).setOrigin(0.5);
  }

  setStatus(text, color) {
    this.status.setText(text).setColor(cssColor(color));
  }
}
