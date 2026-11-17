import { layout, reactionPanelLayout } from '../config/layout.js';
import { Button } from '../objects/Button.js';
import { REACTIONS } from '../online/reactions.js';
import { EMOJI_FONT } from './emojiFont.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 950;

// The panel opened by the Chat button in an online game: Quick chat (4 messages), Reactions (Laugh, Celebrate) and Emojis
// (5). Tapping one sends it and closes the panel; tapping outside, Escape or the Chat button again closes it. A group still
// cooling down (see reactions.js) is shown greyed out.
//   onPick(reaction)       a reaction from REACTIONS was chosen
//   cooldownLeft(kind)     milliseconds until a reaction of that kind may be sent again (0 = now)
//   onClose()              the panel went away
export class ReactionPanel {
  constructor(scene, { onPick, cooldownLeft = () => 0, onClose }) {
    this.scene = scene;
    this.onPick = onPick;
    this.onClose = onClose;
    this.closed = false;
    this.items = [];
    const p = reactionPanelLayout(layout);

    // A see-through blocker: a tap anywhere outside the panel closes it (and does not reach the board).
    this.add(scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.35).setInteractive()).on('pointerdown', () => this.close());
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 0.98).fillRoundedRect(p.cx - p.w / 2, p.top, p.w, p.h, 22);
    panel.lineStyle(3, UI.border, 1).strokeRoundedRect(p.cx - p.w / 2, p.top, p.w, p.h, 22);
    // The panel itself swallows taps between its buttons (so they do not count as "outside").
    this.add(panel);
    this.add(scene.add.rectangle(p.cx, p.top + p.h / 2, p.w, p.h, 0x000000, 0).setInteractive());
    ['Quick chat', 'Reactions', 'Emojis'].forEach((title, i) => this.add(addText(scene, p.left, p.titleYs[i], title, { fontSize: `${p.titleFont}px`, color: UI.muted }).setOrigin(0, 0.5)));

    const button = (r, at, w, h, label) => {
      const b = new Button(scene, at.x, at.y, { label, color: r.kind === 'chat' ? UI.info : r.kind === 'reaction' ? 0x8e44ad : UI.panelLight, width: w, height: h, fontSize: p.btnFont, onClick: () => this.pick(r) });
      b.setEnabled(cooldownLeft(r.kind) <= 0);
      return this.add(b);
    };
    REACTIONS.filter((r) => r.kind === 'chat').forEach((r, i) => button(r, p.chatAt(i), p.colW, p.btnH, r.text));
    REACTIONS.filter((r) => r.kind === 'reaction').forEach((r, i) => button(r, p.reactAt(i), p.colW, p.btnH, r.id === 'laugh' ? 'Laugh' : 'Celebrate'));
    REACTIONS.filter((r) => r.kind === 'emoji').forEach((r, i) => {
      const at = p.emojiAt(i);
      const b = button(r, at, p.emojiW, p.emojiH, '');
      // The picture font has no emojis: they are drawn with the system's emoji font, inside the button so they press with it.
      b.add(scene.add.text(0, 0, r.emoji, { fontFamily: EMOJI_FONT, fontSize: `${Math.round(p.emojiFont)}px` }).setOrigin(0.5));
    });

    // Opening: a quick pop, not a slide, so it feels instant.
    for (const item of this.items.slice(1)) {
      item.setAlpha(0);
      scene.tweens.add({ targets: item, alpha: 1, duration: 120 });
    }
    this.escape = () => this.close();
    scene.input.keyboard?.on('keydown-ESC', this.escape);
    scene.events.once('shutdown', () => this.close());
  }

  add(object) {
    object.setDepth(DEPTH + this.items.length);
    this.items.push(object);
    return object;
  }

  pick(reaction) {
    if (this.closed) return;
    this.close();
    this.onPick(reaction);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    for (const item of this.items) item.destroy();
    this.items = [];
    this.onClose?.();
  }
}
