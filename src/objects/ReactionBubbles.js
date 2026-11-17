import Phaser from 'phaser';
import { COLORS } from '../config/constants.js';
import { estimateTextWidth, layout } from '../config/layout.js';
import { SHOW_MS } from '../online/reactions.js';
import { EMOJI_FONT } from '../ui/emojiFont.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

const DEPTH = 900; // above the board and tokens, below dialogs
const CONFETTI = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, 0xffffff, 0xff80ab];

// Shows the quick chat messages, reactions and emojis players send, next to their avatar. Each seat shows one thing at a time:
// a new one from the same player replaces the old at once (so rapid sends never pile up), while different players' reactions
// show side by side. Everything (objects, tweens, timers) is removed when it ends, when it is replaced, or with the scene.
//   anchorOf(seat) -> { x, y, size }   where that player's avatar (or, without avatars, their die spot) is on screen
export class ReactionBubbles {
  constructor(scene, { anchorOf }) {
    this.scene = scene;
    this.anchorOf = anchorOf;
    this.active = new Map(); // seat -> { objects, timer }
    scene.events.once('shutdown', () => this.clear());
  }

  // `reaction` is an entry of REACTIONS; `name` the sender's name; `color` their colour on this screen.
  show(seat, reaction, { name = '', color = UI.border } = {}) {
    const anchor = this.anchorOf(seat);
    if (!anchor) return null;
    this.remove(seat);
    const entry = { objects: [], timer: null };
    this.active.set(seat, entry);
    const own = (object) => {
      object.setDepth(DEPTH);
      entry.objects.push(object);
      return object;
    };
    if (reaction.kind === 'chat') this.#chat(own, anchor, reaction.text, name, color);
    else if (reaction.kind === 'emoji') this.#emoji(own, anchor, reaction.emoji);
    else if (reaction.id === 'laugh') this.#laugh(own, anchor);
    else this.#celebrate(own, anchor);
    entry.timer = this.scene.time.delayedCall(SHOW_MS[reaction.kind], () => this.#fadeOut(seat, entry));
    return entry;
  }

  // Where a thing of the given size goes: just above the avatar, or below it when that would leave the screen; never past
  // the left or right edge.
  #place(anchor, w, h) {
    const half = anchor.size / 2 + 8;
    let y = anchor.y - half - h / 2;
    if (y - h / 2 < 4) y = anchor.y + half + h / 2;
    const x = Phaser.Math.Clamp(anchor.x, w / 2 + 6, layout.width - w / 2 - 6);
    return { x, y };
  }

  #pop(target, scale = 1) {
    target.setScale(0.2 * scale);
    this.scene.tweens.add({ targets: target, scale, duration: 260, ease: 'Back.easeOut' });
  }

  #chat(own, anchor, text, name, color) {
    const msgFont = layout.ui(22, 13);
    const nameFont = layout.ui(14, 10);
    const w = Math.max(estimateTextWidth(text.length, msgFont), estimateTextWidth(name.length, nameFont)) + 30;
    const h = msgFont * 1.25 + nameFont * 1.3 + 18;
    const at = this.#place(anchor, w, h);
    const box = own(this.scene.add.container(at.x, at.y));
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-w / 2, -h / 2 + 4, w, h, 14);
    g.fillStyle(UI.panelLight, 0.97).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.lineStyle(3, color, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    box.add(g);
    if (name) box.add(addText(this.scene, 0, -h / 2 + 9 + nameFont * 0.6, name, { fontSize: `${nameFont}px`, color: UI.muted }).setOrigin(0.5));
    box.add(addText(this.scene, 0, h / 2 - 9 - msgFont * 0.6, text, { fontSize: `${msgFont}px`, color: '#ffffff' }).setOrigin(0.5));
    this.#pop(box);
  }

  #emoji(own, anchor, emoji) {
    const size = Math.max(anchor.size * 0.9, layout.ui(56, 40));
    const at = this.#place(anchor, size, size);
    const text = own(this.scene.add.text(at.x, at.y, emoji, { fontFamily: EMOJI_FONT, fontSize: `${Math.round(size)}px` }).setOrigin(0.5));
    this.#pop(text);
    this.scene.tweens.add({ targets: text, y: at.y - size * 0.12, duration: 320, delay: 260, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
  }

  // A laughing face drawn in the game (no extra emoji): closed happy eyes, a wide open mouth and two tears, bouncing.
  #laugh(own, anchor) {
    const size = Math.max(anchor.size * 0.9, layout.ui(56, 40));
    const r = size / 2;
    const at = this.#place(anchor, size, size);
    const face = own(this.scene.add.container(at.x, at.y));
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.25).fillCircle(2, 4, r);
    g.fillStyle(0xffd54f, 1).fillCircle(0, 0, r);
    g.lineStyle(Math.max(2, r * 0.09), 0x5d4037, 1);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(side * r * 0.36, -r * 0.18, r * 0.16, Math.PI * 1.1, Math.PI * 1.9, false);
      g.strokePath();
      g.fillStyle(0x4fc3f7, 1).fillEllipse(side * r * 0.7, -r * 0.02, r * 0.18, r * 0.3); // tears of laughter
    }
    g.fillStyle(0x5d4037, 1);
    g.slice(0, r * 0.12, r * 0.55, 0, Math.PI, false);
    g.fillPath();
    g.fillStyle(0xef5350, 1).fillEllipse(0, r * 0.48, r * 0.42, r * 0.2); // tongue
    face.add(g);
    face.add(addText(this.scene, 0, -r - layout.ui(12, 9), 'HA HA!', { fontSize: `${layout.ui(18, 11)}px`, color: '#ffd54f' }).setOrigin(0.5));
    this.#pop(face);
    this.scene.tweens.add({ targets: face, y: at.y - r * 0.25, duration: 180, delay: 260, yoyo: true, repeat: 4, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: face, angle: { from: -8, to: 8 }, duration: 180, delay: 260, yoyo: true, repeat: 4 });
  }

  // A burst of confetti around the avatar with a "YAY!" that pops up.
  #celebrate(own, anchor) {
    const font = layout.ui(26, 15);
    const at = this.#place(anchor, estimateTextWidth(4, font) + 20, font * 1.4);
    const word = own(addText(this.scene, at.x, at.y, 'YAY!', { fontSize: `${font}px`, color: '#ffd54f' }).setOrigin(0.5));
    this.#pop(word, 1.1);
    this.scene.tweens.add({ targets: word, y: at.y - font * 0.4, duration: 300, delay: 260, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
    const spread = anchor.size * 1.1 + 30;
    for (let i = 0; i < 18; i++) {
      const piece = own(this.scene.add.rectangle(anchor.x, anchor.y, 7, 12, CONFETTI[i % CONFETTI.length]));
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const tx = Phaser.Math.Clamp(anchor.x + Math.cos(angle) * spread * (0.6 + Math.random() * 0.4), 6, layout.width - 6);
      const ty = anchor.y + Math.sin(angle) * spread * (0.6 + Math.random() * 0.4);
      this.scene.tweens.add({ targets: piece, x: tx, y: ty, angle: Math.random() * 540 - 270, duration: 650, ease: 'Cubic.easeOut' });
      this.scene.tweens.add({ targets: piece, y: ty + 40, alpha: 0, duration: 900, delay: 650, ease: 'Quad.easeIn' });
    }
  }

  #fadeOut(seat, entry) {
    if (this.active.get(seat) !== entry) return;
    entry.timer = null;
    this.scene.tweens.add({ targets: entry.objects, alpha: 0, duration: 300, onComplete: () => this.remove(seat, entry) });
  }

  // Removes what `seat` is showing (only `entry`, if given: a newer one is left alone).
  remove(seat, entry = this.active.get(seat)) {
    if (!entry || this.active.get(seat) !== entry) return;
    this.active.delete(seat);
    entry.timer?.remove(false);
    for (const object of entry.objects) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
  }

  clear() {
    for (const seat of [...this.active.keys()]) this.remove(seat);
  }
}
