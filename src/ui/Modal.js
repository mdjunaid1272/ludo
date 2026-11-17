import { layout } from '../config/layout.js';
import { Button } from '../objects/Button.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 1000;

// A modal dialog: dims the screen, swallows clicks behind it, and shows a title, a message and
// buttons. Pressing Escape triggers `onDismiss` when given. Call close() to remove it.
export class Modal {
  constructor(scene, { title, message = '', titleColor = '#ffffff', buttons, onDismiss }) {
    this.scene = scene;
    this.closed = false;
    const m = layout.modal;
    const { cx, cy, w: width, h: height } = m;

    this.items = [];
    const add = (obj) => {
      obj.setDepth(DEPTH + this.items.length);
      this.items.push(obj);
      return obj;
    };

    // Full-screen blocker: being interactive and on top, it stops clicks reaching the game.
    add(scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.65).setInteractive());
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(cx - width / 2, cy - height / 2, width, height, 24);
    panel.lineStyle(3, UI.border, 1).strokeRoundedRect(cx - width / 2, cy - height / 2, width, height, 24);
    add(panel);
    add(addText(scene, cx, cy - height * 0.3, title, { fontSize: `${m.titleFont}px`, color: titleColor }).setOrigin(0.5));
    add(addText(scene, cx, cy - height * 0.05, message, { fontSize: `${m.messageFont}px`, color: UI.muted, align: 'center', wordWrap: { width: width - 60 } }).setOrigin(0.5));

    const gap = 20;
    const btnWidth = Math.min(220, (width - 60 - gap * (buttons.length - 1)) / buttons.length);
    const total = btnWidth * buttons.length + gap * (buttons.length - 1);
    buttons.forEach((b, i) => {
      const x = cx - total / 2 + btnWidth / 2 + i * (btnWidth + gap);
      add(
        new Button(scene, x, cy + height * 0.3, {
          label: b.label,
          color: b.color,
          width: btnWidth,
          height: m.btnH,
          fontSize: m.btnFont,
          onClick: () => b.onClick?.(),
        }).setEnabled(b.enabled !== false), // a button can be shown greyed out and unclickable
      );
    });

    this.onDismiss = onDismiss;
    if (onDismiss) {
      this.escape = () => onDismiss();
      scene.input.keyboard?.on('keydown-ESC', this.escape);
    }

    // Entrance animation.
    for (const item of this.items.slice(1)) item.setAlpha(0);
    scene.tweens.add({ targets: this.items.slice(1), alpha: 1, duration: 140 });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.escape) this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    for (const item of this.items) item.destroy();
    this.items = [];
  }
}
