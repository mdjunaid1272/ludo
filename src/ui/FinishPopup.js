import { finishLayout, layout } from '../config/layout.js';
import { Avatar } from '../objects/Avatar.js';
import { Button } from '../objects/Button.js';
import { medalColor, ordinal } from './ranking.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 1000;

// "Player482 finished 1st!": a compact popup with the position (in its medal colour), the player's avatar and name, and a
// Continue Match button. In a game on one device it is modal (the game waits for Continue); online it only covers the
// middle of the screen and goes away by itself after `autoCloseMs`, because the other players are still playing.
//   `onClose()` is called once, when the popup goes away.
export class FinishPopup {
  constructor(scene, { name, avatarKey, position, color, modal = true, autoCloseMs = 0, onClose }) {
    this.scene = scene;
    this.closed = false;
    this.onClose = onClose;
    this.items = [];
    const f = finishLayout();
    const medal = medalColor(position);
    if (modal) this.add(scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.55).setInteractive());
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(f.cx - f.w / 2, f.top, f.w, f.h, 24);
    panel.lineStyle(4, medal, 1).strokeRoundedRect(f.cx - f.w / 2, f.top, f.w, f.h, 24);
    this.add(panel);
    this.add(addText(scene, f.cx, f.posY, ordinal(position), { fontSize: `${f.posFont}px`, color: `#${medal.toString(16).padStart(6, '0')}` }).setOrigin(0.5));
    if (f.avatar > 0 && avatarKey && scene.textures.exists(avatarKey)) this.add(new Avatar(scene, f.cx, f.avatarY, { textureKey: avatarKey, size: f.avatar, color }).setTurn(true));
    this.add(addText(scene, f.cx, f.nameY, name, { fontSize: `${f.nameFont}px`, color: '#ffffff' }).setOrigin(0.5));
    this.add(addText(scene, f.cx, f.noteY, `finished ${ordinal(position)}!`, { fontSize: `${f.noteFont}px`, color: UI.muted }).setOrigin(0.5));
    this.add(new Button(scene, f.cx, f.btnY, { label: 'Continue Match', color: UI.ok, width: f.btnW, height: f.btnH, fontSize: f.btnFont, onClick: () => this.close() }));

    this.escape = () => this.close();
    scene.input.keyboard?.on('keydown-ESC', this.escape);
    scene.events.once('shutdown', () => this.close());
    if (autoCloseMs > 0) this.timer = scene.time.delayedCall(autoCloseMs, () => this.close());
  }

  add(object) {
    object.setDepth(DEPTH + this.items.length);
    this.items.push(object);
    return object;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.timer?.remove(false);
    this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    for (const item of this.items) item.destroy();
    this.items = [];
    this.onClose?.();
  }
}
