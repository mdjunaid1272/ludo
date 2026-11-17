import { layout } from '../config/layout.js';
import { Button } from '../objects/Button.js';
import { addText } from './SpriteText.js';
import { UI, cssColor } from './theme.js';

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
      this.restartButton = new Button(scene, hud.restart.x, hud.restart.y, { label: 'Restart', color: UI.neutral, width: hud.restart.w, height: hud.restart.h, fontSize: hud.restart.font, onClick: onRestart });
      this.restartButton.setEnabled(restartEnabled);
    }
    this.menuButton = new Button(scene, hud.menu.x, hud.menu.y, { label: 'Menu', color: UI.neutral, width: hud.menu.w, height: hud.menu.h, fontSize: hud.menu.font, onClick: onMenu });

    this.status = addText(scene, hud.status.x, hud.status.y, '', { fontSize: `${hud.status.font}px`, align: 'center', wordWrap: { width: hud.status.w } }).setOrigin(0.5);
  }

  setStatus(text, color) {
    this.status.setText(text).setColor(cssColor(color));
  }
}
