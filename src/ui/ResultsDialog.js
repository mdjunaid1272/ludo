import { layout, resultsLayout } from '../config/layout.js';
import { Avatar } from '../objects/Avatar.js';
import { Button } from '../objects/Button.js';
import { medalColor, ordinal } from './ranking.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 1000;

// The final results, when every position is decided: one row per player in finishing order with the medal, the avatar and
// the name, then the buttons (Play again / Home, or Rematch / Menu online).
//   rows:    [{ name, avatarKey, color, position }] in finishing order
//   buttons: [{ label, color, onClick, enabled }]
export class ResultsDialog {
  constructor(scene, { rows, buttons }) {
    this.scene = scene;
    this.closed = false;
    this.items = [];
    const r = resultsLayout(layout, rows.length);
    this.add(scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.7).setInteractive());
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(r.cx - r.w / 2, r.top, r.w, r.h, 24);
    panel.lineStyle(3, UI.border, 1).strokeRoundedRect(r.cx - r.w / 2, r.top, r.w, r.h, 24);
    this.add(panel);
    this.add(addText(scene, r.cx, r.titleY, 'Final results', { fontSize: `${r.titleFont}px`, color: '#ffffff' }).setOrigin(0.5));

    const left = r.cx - r.inner / 2;
    rows.forEach((row, i) => {
      const y = r.rowY(i);
      const medal = medalColor(row.position);
      const bg = scene.add.graphics();
      bg.fillStyle(row.position === 1 ? 0x3a3420 : UI.panelLight, 1).fillRoundedRect(left, y - r.rowH / 2, r.inner, r.rowH, 14);
      bg.lineStyle(row.position === 1 ? 3 : 2, row.position === 1 ? medal : UI.border, 1).strokeRoundedRect(left, y - r.rowH / 2, r.inner, r.rowH, 14);
      this.add(bg);
      this.add(scene.add.circle(left + 12 + r.badge / 2, y, r.badge / 2, medal).setStrokeStyle(2, 0x1b1f2a));
      this.add(addText(scene, left + 12 + r.badge / 2, y, String(row.position), { fontSize: `${r.badge * 0.6}px`, color: '#ffffff' }).setOrigin(0.5));
      if (row.avatarKey && scene.textures.exists(row.avatarKey)) this.add(new Avatar(scene, left + 12 + r.badge + 12 + r.avatar / 2, y, { textureKey: row.avatarKey, size: r.avatar - 8, color: row.color }).setTurn(true));
      this.add(addText(scene, r.nameX, y - r.nameFont * 0.4, row.name, { fontSize: `${r.nameFont}px`, color: '#ffffff' }).setOrigin(0, 0.5));
      this.add(addText(scene, r.nameX, y + r.nameFont * 0.75, ordinal(row.position), { fontSize: `${Math.max(r.nameFont * 0.7, 10)}px`, color: `#${medal.toString(16).padStart(6, '0')}` }).setOrigin(0, 0.5));
    });

    const half = r.footW / 2 + r.footGap / 2;
    buttons.forEach((b, i) => {
      const x = buttons.length === 1 ? r.cx : r.cx + (i === 0 ? -half : half);
      this.add(new Button(scene, x, r.footY, { label: b.label, color: b.color, width: r.footW, height: r.footH, fontSize: r.footFont, onClick: () => b.onClick?.() }).setEnabled(b.enabled !== false));
    });
    scene.events.once('shutdown', () => this.close());
  }

  add(object) {
    object.setDepth(DEPTH + this.items.length);
    this.items.push(object);
    return object;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.items) item.destroy();
    this.items = [];
  }
}
