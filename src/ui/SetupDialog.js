import { PLAYERS } from '../config/constants.js';
import { layout } from '../config/layout.js';
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
    this.add(this.frame, addText(scene, s.cx, s.titleY, SETUP_TITLES[mode], { fontSize: `${s.titleFont}px`, color: '#ffffff' }).setOrigin(0.5));

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

  buildFooter() {
    const s = layout.setup;
    const common = { color: UI.neutral, width: s.backW, height: s.backH, fontSize: s.backFont };
    const label = this.step === 1 || this.mode === 'online' ? 'Cancel' : 'Back';
    if (this.step === 2 && this.mode === 'local') {
      const half = s.backW / 2 + s.footGap / 2;
      this.add(this.content, new Button(this.scene, s.cx - half, s.backY, { ...common, label, onClick: () => this.back() }));
      const ready = this.picked.length === this.count;
      this.add(this.content, new Button(this.scene, s.cx + half, s.backY, { ...common, label: 'Start', color: UI.ok, onClick: () => this.start([...this.picked]) }).setEnabled(ready));
    } else {
      this.add(this.content, new Button(this.scene, s.cx, s.backY, { ...common, label, onClick: () => this.back() }));
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
