import Phaser from 'phaser';
import { layout } from '../config/layout.js';
import { SETTING_ROWS } from '../config/settingsRows.js';
import { settingsStore } from '../config/settingsStore.js';
import { cycleOption } from '../game/settings.js';
import { Button } from '../objects/Button.js';
import { addBackground } from '../ui/background.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

// Game options. Each row cycles through its values on click and saves immediately.
// Rows are placed by layout.settings: one column in portrait, two in landscape.
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('SettingsScene');
  }

  create() {
    const s = layout.settings;
    this.settings = settingsStore.load();
    this.controls = new Map();
    addBackground(this);

    addText(this, layout.width / 2, s.titleY, 'Settings', { fontSize: `${s.titleFont}px`, color: '#ffffff' }).setOrigin(0.5);

    SETTING_ROWS.forEach((row, i) => this.addRow(row, s.rowRect(i)));

    this.note = addText(this, layout.width / 2, s.footerY - s.footerH / 2 - 14, '', { fontSize: `${s.descFont}px`, color: UI.muted, align: 'center', wordWrap: { width: layout.width - 60 } }).setOrigin(0.5);
    const footer = { color: UI.neutral, height: s.footerH, fontSize: s.footerFont };
    new Button(this, s.margin + s.resetW / 2, s.footerY, { ...footer, label: 'Reset defaults', width: s.resetW, onClick: () => this.resetDefaults() });
    new Button(this, layout.width - s.margin - s.backW / 2, s.footerY, { ...footer, color: UI.info, label: 'Back', width: s.backW, onClick: () => this.scene.start('MenuScene') });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
  }

  addRow(row, rect) {
    const s = layout.settings;
    const panel = this.add.graphics();
    panel.fillStyle(UI.panel, 1).fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 14);
    const cy = rect.y + rect.h / 2;
    const left = rect.x + 24;
    addText(this, left, s.showDesc ? cy - s.labelFont * 0.45 : cy, row.label, { fontSize: `${s.labelFont}px`, color: UI.text }).setOrigin(0, 0.5);
    if (s.showDesc) {
      addText(this, left, cy + s.descFont * 1.05, row.desc, { fontSize: `${s.descFont}px`, color: UI.muted }).setOrigin(0, 0.5);
    }

    const button = new Button(this, rect.x + rect.w - 24 - s.btnW / 2, cy, {
      label: '',
      color: UI.info,
      width: s.btnW,
      height: s.btnH,
      fontSize: s.btnFont,
      onClick: () => {
        this.settings = row.write(this.settings, cycleOption(row.options, row.read(this.settings)));
        this.persist();
        this.refresh();
      },
    });
    this.controls.set(row.id, { row, button });
    this.refresh();
  }

  persist() {
    const saved = settingsStore.save(this.settings);
    this.note.setText(saved ? '' : 'Could not save settings in this browser; they apply until you leave this screen.');
  }

  refresh() {
    for (const { row, button } of this.controls.values()) {
      const value = row.read(this.settings);
      button.setLabel(row.format(value));
      button.setColor(typeof value === 'boolean' ? (value ? UI.ok : UI.neutral) : UI.info);
    }
  }

  resetDefaults() {
    this.settings = settingsStore.reset();
    this.refresh();
  }
}
