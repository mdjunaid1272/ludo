import { SETUP_POPUP_IMAGES } from '../config/assets.js';
import { PLAYERS } from '../config/constants.js';
import { layout } from '../config/layout.js';
import { POPUPS, POPUP_MADE_WIDTH } from '../config/setupPopup.js';
import { PLAYER_COUNTS, isValidColorSet, playersFor } from '../game/settings.js';
import { PLAY_ONLINE_SIZE } from '../online/protocol.js';
import { Button } from '../objects/Button.js';
import { addText } from './SpriteText.js';
import { UI } from './theme.js';

const DEPTH = 1000;

export const SETUP_TITLES = { computer: 'Player vs Computer', local: 'Local Multiplayer', online: 'Play Online' };

// The game setup popup, in two steps (Play Online has only the colour step):
//   1. "How many players?"  -> 2, 3 or 4
//   2. colours:
//        mode 'computer' - "pick your colour": tapping one starts the game
//        mode 'local'    - "choose N colours": tap to toggle exactly N colours, then Start
//                          (with 4 players every colour plays, so the game starts straight away)
//        mode 'online'   - "pick your colour": the only step; tapping one starts the search for a match
// The first step of Player vs Computer and of Local Multiplayer is a picture (img/UI boards) with the title, the question and the
// three buttons in it; invisible tap areas lie over its buttons. Everything else uses the drawn panel.
// Cancel (step 1) / Back (step 2) and the Escape key step backwards. The previous choices are pre-selected
// or outlined in gold. `onStart({ count, colors })` is called when the game should begin; `onCancel()` when
// the popup is dismissed.
export class SetupDialog {
  constructor(scene, { mode = 'computer', lastCount, lastColor, lastColors, onStart, onCancel }) {
    this.scene = scene;
    this.mode = mode;
    this.lastCount = lastCount;
    this.lastColor = lastColor;
    this.lastColors = lastColors;
    this.onStart = onStart;
    this.onCancel = onCancel;
    this.closed = false;
    this.step = 1;
    this.count = null;
    this.picked = [];
    this.frame = [];
    this.content = [];

    const s = layout.setup;
    // Full-screen blocker, so nothing behind the popup can be tapped.
    this.add(this.frame, scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x000000, 0.65).setInteractive());
    const panel = scene.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(s.cx - s.w / 2, s.top, s.w, s.h, 24);
    panel.lineStyle(3, UI.border, 1).strokeRoundedRect(s.cx - s.w / 2, s.top, s.w, s.h, 24);
    this.add(this.frame, panel);
    const title = this.add(this.frame, addText(scene, s.cx, s.titleY, SETUP_TITLES[mode], { fontSize: `${s.titleFont}px`, color: '#ffffff' }).setOrigin(0.5));
    this.plain = [panel, title]; // the drawn panel and title: hidden while the picture of the first step is shown

    this.escape = () => this.back();
    scene.input.keyboard?.on('keydown-ESC', this.escape);
    if (mode === 'online') this.count = PLAY_ONLINE_SIZE; // no question about the number of players
    this.showStep(mode === 'online' ? 2 : 1);
  }

  add(list, object) {
    object.setDepth(DEPTH + this.frame.length + this.content.length);
    list.push(object);
    return object;
  }

  // Rebuilds the prompt, the row of choices and the footer buttons for a step.
  showStep(step) {
    this.step = step;
    for (const item of this.content) item.destroy();
    this.content = [];
    const s = layout.setup;

    const pictured = step === 1 && Boolean(POPUPS[this.mode]) && Boolean(this.scene.textures?.exists?.(SETUP_POPUP_IMAGES[this.mode]));
    for (const object of this.plain) object.setVisible(!pictured);
    if (pictured) {
      this.buildPicturedStep1();
      return;
    }

    let prompt = 'How many players?';
    if (step === 2) {
      if (this.mode === 'online') prompt = 'Pick your colour';
      else prompt = this.mode === 'local' ? `Choose ${this.count} colours (${this.picked.length}/${this.count})` : `${this.count} players: pick your colour`;
    }
    this.add(this.content, addText(this.scene, s.cx, s.promptY, prompt, { fontSize: `${s.promptFont}px`, color: UI.muted }).setOrigin(0.5));

    if (step === 1) this.buildCountRow();
    else if (this.mode === 'local') this.buildColourToggles();
    else this.buildColourChoices();
    this.buildFooter();
  }

  // The first step of Player vs Computer / Local Multiplayer: the picture, with a tap area over each of its three buttons, and Cancel under it.
  buildPicturedStep1() {
    const { scene } = this;
    const s = layout.setup;
    const gap = 16;
    // The board of the picture is as wide as the ordinary panel, unless the screen is too short for it.
    const popup = POPUPS[this.mode];
    const k = Math.min(s.w / popup.bodyWidth, (layout.height - 40 - s.backH - gap) / popup.height);
    const width = POPUP_MADE_WIDTH * k;
    const height = popup.height * k;
    const top = (layout.height - (height + gap + s.backH)) / 2;
    const left = s.cx - width / 2;
    this.add(this.content, scene.add.image(s.cx, top, SETUP_POPUP_IMAGES[this.mode]).setOrigin(0.5, 0).setDisplaySize(width, height));
    for (const n of PLAYER_COUNTS) {
      const b = popup.buttons[n];
      const x = left + b.x * k;
      const y = top + b.y * k;
      const w = b.w * k;
      const h = b.h * k;
      if (n === this.lastCount) {
        // the choice made last time is outlined in gold, as on the drawn buttons
        this.add(this.content, scene.add.graphics().lineStyle(4, UI.accent, 1).strokeRoundedRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, 24));
      }
      const glow = this.add(this.content, scene.add.rectangle(x, y, w, h, 0xffffff, 0).setStrokeStyle(0));
      const area = this.add(this.content, scene.add.rectangle(x, y, w, h, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
      area.on('pointerover', () => glow.setFillStyle(0xffffff, 0.12));
      area.on('pointerout', () => glow.setFillStyle(0xffffff, 0));
      area.on('pointerdown', () => {
        glow.setFillStyle(0xffffff, 0.35);
        this.chooseCount(n);
      });
    }
    this.buildFooter(top + height + gap + s.backH / 2);
  }

  buildCountRow() {
    const s = layout.setup;
    const total = s.countW * PLAYER_COUNTS.length + s.countGap * (PLAYER_COUNTS.length - 1);
    PLAYER_COUNTS.forEach((n, i) => {
      const x = s.cx - total / 2 + s.countW / 2 + i * (s.countW + s.countGap);
      this.add(
        this.content,
        new Button(this.scene, x, s.rowY, {
          label: String(n),
          sublabel: 'players',
          color: UI.info,
          width: s.countW,
          height: s.btnH,
          fontSize: s.countFont,
          outlineColor: n === this.lastCount ? UI.accent : 0xffffff,
          onClick: () => this.chooseCount(n),
        }),
      );
    });
  }

  chooseCount(n) {
    this.count = n;
    if (this.mode === 'local') {
      if (n === PLAYER_COUNTS[PLAYER_COUNTS.length - 1]) {
        // Everyone plays: nothing to choose.
        this.start(PLAYERS.map((p) => p.id));
        return;
      }
      // Start from the last selection if it matches this count, otherwise the usual colours for it.
      this.picked = isValidColorSet(this.lastColors) && this.lastColors.length === n ? [...this.lastColors] : playersFor(n);
    }
    this.showStep(2);
  }

  // Computer mode: one colour for the person; tapping it starts the game.
  buildColourChoices() {
    this.colourRow((p) => ({
      outlineColor: p.id === this.lastColor ? UI.accent : 0xffffff,
      onClick: () => this.start([p.id]),
    }));
  }

  // Local mode: toggle which colours play.
  buildColourToggles() {
    this.colourRow((p) => ({
      outlineColor: this.picked.includes(p.id) ? UI.accent : 0xffffff,
      alpha: this.picked.includes(p.id) ? 1 : 0.4,
      onClick: () => this.toggle(p.id),
    }));
  }

  colourRow(optionsFor) {
    const s = layout.setup;
    const total = s.colorW * PLAYERS.length + s.colorGap * (PLAYERS.length - 1);
    PLAYERS.forEach((p, i) => {
      const x = s.cx - total / 2 + s.colorW / 2 + i * (s.colorW + s.colorGap);
      const { alpha = 1, ...options } = optionsFor(p);
      const button = new Button(this.scene, x, s.rowY, {
        label: p.label,
        color: p.color,
        textColor: p.id === 'yellow' ? '#222222' : '#ffffff', // yellow is too light for white text
        width: s.colorW,
        height: s.btnH,
        fontSize: s.colorFont,
        ...options,
      });
      button.setAlpha(alpha);
      this.add(this.content, button);
    });
  }

  // Selecting beyond the limit drops the oldest pick, so the player is never stuck.
  toggle(id) {
    if (this.picked.includes(id)) this.picked = this.picked.filter((c) => c !== id);
    else this.picked = [...this.picked, id].slice(-this.count);
    this.showStep(2);
  }

  buildFooter(y = layout.setup.backY) {
    const s = layout.setup;
    const common = { color: UI.neutral, width: s.backW, height: s.backH, fontSize: s.backFont };
    const label = this.step === 1 || this.mode === 'online' ? 'Cancel' : 'Back';
    if (this.step === 2 && this.mode === 'local') {
      const half = s.backW / 2 + s.footGap / 2;
      this.add(this.content, new Button(this.scene, s.cx - half, y, { ...common, label, onClick: () => this.back() }));
      const ready = this.picked.length === this.count;
      this.add(this.content, new Button(this.scene, s.cx + half, y, { ...common, label: 'Start', color: UI.ok, onClick: () => this.start([...this.picked]) }).setEnabled(ready));
    } else {
      this.add(this.content, new Button(this.scene, s.cx, y, { ...common, label, onClick: () => this.back() }));
    }
  }

  start(colors) {
    if (this.closed) return;
    const count = this.count;
    this.close();
    this.onStart({ count, colors });
  }

  // Back from the colour step to the player count, or out of the popup from the first step.
  back() {
    if (this.closed) return;
    if (this.step === 2 && this.mode !== 'online') {
      this.showStep(1);
      return;
    }
    this.close();
    this.onCancel?.();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    for (const item of [...this.frame, ...this.content]) item.destroy();
    this.frame = [];
    this.content = [];
  }
}
