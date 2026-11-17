import { layout } from '../config/layout.js';
import { NAME_MAX, validateName } from '../game/playerName.js';
import { Avatar } from '../objects/Avatar.js';
import { Button } from '../objects/Button.js';
import { avatarForName } from './profileAvatar.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 1000;

// The "Your profile" popup: your avatar and current name, a text field to change it (with a character counter and a
// message when the name is not allowed), and Cancel / Save. The field is a real text box laid over the canvas, so phones
// bring up their keyboard and people can paste; everything else is drawn in the game.
//   `name`      the current name
//   `onSave(name)` called with the cleaned, valid name when Save is pressed
//   `onCancel()`  when the popup is dismissed without saving (Cancel, Escape)
export class ProfileDialog {
  constructor(scene, { name, onSave, onCancel }) {
    this.scene = scene;
    this.name = name;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.closed = false;
    this.items = [];

    const p = layout.profile;
    this.add(scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.65).setInteractive()); // blocks what is behind
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(p.cx - p.w / 2, p.top, p.w, p.h, 24);
    panel.lineStyle(3, UI.border, 1).strokeRoundedRect(p.cx - p.w / 2, p.top, p.w, p.h, 24);
    this.add(panel);
    this.add(addText(scene, p.cx, p.titleY, 'Your profile', { fontSize: `${p.titleFont}px`, color: '#ffffff' }).setOrigin(0.5));
    if (p.avatar > 0) {
      const key = avatarForName(name);
      if (key && scene.textures.exists(key)) this.add(new Avatar(scene, p.cx, p.avatarY, { textureKey: key, size: p.avatar, color: UI.accent }).setTurn(true));
    }
    this.currentName = this.add(addText(scene, p.cx, p.nameY, name, { fontSize: `${p.nameFont}px`, color: '#ffd54f' }).setOrigin(0.5));

    // The field itself is drawn here (so it matches the game); the text box laid over it has no frame of its own.
    const field = scene.add.graphics();
    field.fillStyle(UI.panelLight, 1).fillRoundedRect(p.cx - p.fieldW / 2, p.fieldY - p.fieldH / 2, p.fieldW, p.fieldH, 14);
    this.fieldFrame = field;
    this.add(field);
    this.message = this.add(addText(scene, p.cx - p.fieldW / 2, p.noteY, '', { fontSize: `${p.noteFont}px`, color: '#ef9a9a' }).setOrigin(0, 0.5));
    this.counter = this.add(addText(scene, p.cx + p.fieldW / 2, p.noteY, '', { fontSize: `${p.noteFont}px`, color: UI.muted }).setOrigin(1, 0.5));

    const half = p.footW / 2 + p.footGap / 2;
    const foot = { width: p.footW, height: p.footH, fontSize: p.footFont };
    this.add(new Button(scene, p.cx - half, p.footY, { ...foot, label: 'Cancel', color: UI.neutral, onClick: () => this.cancel() }));
    this.save = this.add(new Button(scene, p.cx + half, p.footY, { ...foot, label: 'Save', color: UI.ok, onClick: () => this.trySave() }));

    this.escape = () => this.cancel();
    scene.input.keyboard?.on('keydown-ESC', this.escape);
    scene.events.once('shutdown', () => this.close());
    this.buildInput();
    this.refresh();
  }

  add(object) {
    object.setDepth(DEPTH + this.items.length);
    this.items.push(object);
    return object;
  }

  // The text box, placed over the drawn field. The page's coordinates are the canvas's scaled by (shown width / layout width).
  buildInput() {
    const doc = globalThis.document;
    if (!doc) return;
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = this.name;
    input.maxLength = NAME_MAX * 2; // typing more is allowed so the message can explain; the counter turns red
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Your name');
    input.setAttribute('enterkeyhint', 'done');
    input.id = 'ludo-name-input';
    Object.assign(input.style, {
      position: 'fixed', boxSizing: 'border-box', margin: '0', padding: '0 14px', border: '0', outline: 'none', background: 'transparent',
      color: '#ffffff', fontFamily: 'Arial, sans-serif', fontWeight: '700', zIndex: '10',
    });
    input.addEventListener('input', () => this.refresh());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.trySave(); }
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      e.stopPropagation(); // typing must not reach the game's own key handlers
    });
    doc.body.appendChild(input);
    this.input = input;
    this.place();
    this.onResize = () => this.place();
    globalThis.addEventListener?.('resize', this.onResize);
    input.focus({ preventScroll: true });
    input.select();
  }

  place() {
    const canvas = this.scene.sys.game.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect || !this.input) return;
    const p = layout.profile;
    const k = rect.width / layout.width;
    Object.assign(this.input.style, {
      left: `${rect.left + (p.cx - p.fieldW / 2) * k}px`,
      top: `${rect.top + (p.fieldY - p.fieldH / 2) * k}px`,
      width: `${p.fieldW * k}px`,
      height: `${p.fieldH * k}px`,
      fontSize: `${p.fieldFont * k}px`,
    });
  }

  typed() {
    return this.input ? this.input.value : this.name;
  }

  // Shows the character counter and, when the name is not allowed, why; Save only works for a valid name.
  refresh() {
    const text = this.typed();
    const result = validateName(text);
    const length = text.trim().length;
    this.counter.setText(`${length}/${NAME_MAX}`);
    this.counter.setColor(length > NAME_MAX ? '#ef9a9a' : UI.muted);
    this.message.setText(result.ok ? '' : result.error);
    this.save.setEnabled(result.ok);
    this.fieldFrame.clear();
    const p = layout.profile;
    this.fieldFrame.fillStyle(UI.panelLight, 1).fillRoundedRect(p.cx - p.fieldW / 2, p.fieldY - p.fieldH / 2, p.fieldW, p.fieldH, 14);
    this.fieldFrame.lineStyle(3, result.ok ? UI.accent : UI.danger, 1).strokeRoundedRect(p.cx - p.fieldW / 2, p.fieldY - p.fieldH / 2, p.fieldW, p.fieldH, 14);
  }

  trySave() {
    if (this.closed) return;
    const result = validateName(this.typed());
    if (!result.ok) {
      this.refresh(); // shows the reason; nothing is saved
      return;
    }
    this.close();
    this.onSave(result.name);
  }

  cancel() {
    if (this.closed) return;
    this.close();
    this.onCancel?.();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    globalThis.removeEventListener?.('resize', this.onResize);
    this.input?.remove();
    this.input = null;
    for (const item of this.items) item.destroy();
    this.items = [];
  }
}
