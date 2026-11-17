import Phaser from 'phaser';
import { drawBoard } from '../src/board/drawBoard.js';
import { drawSafeCells } from '../src/board/drawSafeCells.js';
import { gridToPixel } from '../src/board/geometry.js';
import { COLORS, PLAYERS } from '../src/config/constants.js';
import { layout } from '../src/config/layout.js';
import { GameState } from '../src/game/GameState.js';
import { computeTokenSlots, tokenKey } from '../src/game/tokenLayout.js';
import { Button } from '../src/objects/Button.js';
import { Dice } from '../src/objects/Dice.js';
import { MoveHints } from '../src/objects/MoveHints.js';
import { Token } from '../src/objects/Token.js';
import { SPRITE_FONTS } from '../src/config/assets.js';
import { addText } from '../src/ui/SpriteText.js';
import { UI, cssColor } from '../src/ui/theme.js';

// Development tool: lays out every visual in the game, drawn by the game's own code, on one sheet.
// Open /tools/assets.html while `npm run dev` is running. (Not part of the production build.)
const W = 1600;
const H = 1640;
const still = { tween: () => Promise.resolve(), delay: () => Promise.resolve() }; // no animation on a sheet

class SheetScene extends Phaser.Scene {
  constructor() {
    super('SheetScene');
  }

  preload() {
    for (const { key, png, xml } of SPRITE_FONTS) this.load.bitmapFont(key, png, xml);
  }

  label(text, x, y, size = 20, color = '#b0bec5', _bold = false, origin = [0, 0.5]) {
    return addText(this, x, y, text, { fontSize: `${size}px`, color }).setOrigin(...origin);
  }

  heading(text, x, y) {
    this.label(text, x, y, 26, '#ffffff', true);
    this.add.rectangle(x + 150, y + 22, 300, 2, 0x3a4258).setOrigin(0, 0.5);
  }

  create() {
    this.cameras.main.setBackgroundColor(0x151a26);
    addText(this, 40, 40, 'LUDO  -  Asset Sheet', { fontSize: '54px', color: '#ffffff' }).setOrigin(0, 0.5);
    this.label('Drawn by the game code (text uses the picture font). Board cell: 48 px, board: 720 x 720 px.', 40, 92, 20);

    // ---- board
    layout.boardX = 40;
    layout.boardY = 150;
    this.heading('Board (15 x 15 cells, with a game in progress)', 40, 126);
    drawBoard(this);
    drawSafeCells(this);
    const state = new GameState();
    state.tokens.red = [-1, 7, 33, 56];
    state.tokens.green = [-1, -1, 12, 12];
    state.tokens.yellow = [4, 20, 20, 53];
    state.tokens.blue = [-1, -1, -1, 28];
    const slots = computeTokenSlots(state.tokens);
    for (const player of PLAYERS) {
      state.tokens[player.id].forEach((_, i) => {
        const { gx, gy, scale } = slots.get(tokenKey(player.id, i));
        const { x, y } = gridToPixel(gx, gy);
        new Token(this, still, player, i).settle(x, y, scale, false);
      });
    }

    // ---- right column
    const rx = 820;
    this.heading('Colour palette', rx, 126);
    const swatches = [
      ['Red', COLORS.red], ['Green', COLORS.green], ['Yellow', COLORS.yellow], ['Blue', COLORS.blue],
      ['Background', COLORS.background], ['Panel', UI.panel], ['Panel light', UI.panelLight], ['Border', UI.border],
      ['Accent', UI.accent], ['Danger', UI.danger], ['OK', UI.ok], ['Info', UI.info], ['Neutral', UI.neutral], ['Board line', COLORS.line],
    ];
    swatches.forEach(([name, color], i) => {
      const x = rx + (i % 7) * 108;
      const y = 175 + Math.floor(i / 7) * 118;
      this.add.rectangle(x + 44, y + 30, 88, 60, color).setStrokeStyle(2, 0xffffff, 0.5);
      this.label(name, x + 44, y + 74, 15, '#ffffff', true, [0.5, 0.5]);
      this.label(cssColor(color), x + 44, y + 92, 14, '#90a4ae', false, [0.5, 0.5]);
    });

    this.heading('Tokens  (normal / can move / stacked 2 / stacked 3)', rx, 440);
    PLAYERS.forEach((player, c) => {
      const x = rx + 60 + c * 190;
      new Token(this, still, player, 0).settle(x, 525, 1, false);
      const movable = new Token(this, still, player, 1);
      movable.settle(x, 615, 1, false);
      movable.setMovable(true, { onClick() {} });
      movable.pulse.stop();
      movable.haloTween.stop();
      movable.view.setScale(1);
      movable.halo.setAlpha(1);
      for (let k = 0; k < 2; k++) new Token(this, still, player, 2).settle(x - 18 + k * 36, 705, 0.75, false);
      for (let k = 0; k < 3; k++) new Token(this, still, player, 3).settle(x + Math.cos((2 * Math.PI * k) / 3 - Math.PI / 2) * 18, 795 + Math.sin((2 * Math.PI * k) / 3 - Math.PI / 2) * 18, 0.62, false);
      this.label(player.label, x, 840, 15, '#ffffff', true, [0.5, 0.5]);
    });

    this.heading('Dice  (faces 1-6, owner colours, ready glow)', rx, 880);
    for (let v = 1; v <= 6; v++) {
      const d = new Dice(this, still, rx + 50 + (v - 1) * 118, 975, 72);
      d.setValue(v);
    }
    PLAYERS.forEach((player, i) => {
      const d = new Dice(this, still, rx + 50 + i * 118, 1085, 72);
      d.setValue(i + 3);
      d.setOwner(player.color);
    });
    const glow = new Dice(this, still, rx + 50 + 4 * 118, 1085, 72);
    glow.setValue(6);
    glow.setReady(true);
    glow.pulse.stop();
    glow.gfx.setScale(glow.base);
    this.label('ready to roll', rx + 50 + 4 * 118, 1140, 15, '#ffffff', true, [0.5, 0.5]);

    this.heading('Buttons', rx, 1180);
    const button = (x, y, o) => new Button(this, x, y, o);
    button(rx + 190, 1265, { label: 'Local Multiplayer', sublabel: 'Pick players and colours', color: COLORS.blue, width: 360, height: 76, fontSize: 26 });
    button(rx + 580, 1265, { label: 'Player vs Computer', sublabel: 'Pick players and colour', color: COLORS.green, width: 360, height: 76, fontSize: 26 });
    button(rx + 100, 1355, { label: 'Restart', color: UI.neutral, width: 160, height: 46, fontSize: 18 });
    button(rx + 290, 1355, { label: 'Start', color: UI.ok, width: 160, height: 46, fontSize: 18 });
    button(rx + 480, 1355, { label: 'Leave', color: UI.danger, width: 160, height: 46, fontSize: 18 });
    button(rx + 670, 1355, { label: 'Disabled', color: UI.neutral, width: 160, height: 46, fontSize: 18 }).setEnabled(false);
    PLAYERS.forEach((p, i) => button(rx + 80 + i * 175, 1430, { label: p.label, color: p.color, textColor: p.id === 'yellow' ? '#222222' : '#ffffff', width: 150, height: 52, fontSize: 18 }));

    // ---- below the board: stacked sections
    let y = 905;

    y = 1075;
    this.heading('Board markers', 40, y);
    new MoveHints(this).show([
      { key: 'a', x: 90, y: y + 75, color: COLORS.red },
      { key: 'b', x: 170, y: y + 75, color: COLORS.blue },
    ]);
    this.tweens.killAll();
    this.add.star(280, y + 75, 5, CELL_STAR.inner, CELL_STAR.outer, 0xffffff).setStrokeStyle(2, 0x2b2f3a);
    this.add.star(340, y + 75, 5, CELL_STAR.inner, CELL_STAR.outer, COLORS.line);
    this.label('move targets', 130, y + 118, 14, '#90a4ae', false, [0.5, 0.5]);
    this.label('start / star cells', 310, y + 118, 14, '#90a4ae', false, [0.5, 0.5]);

    y = 1235;
    this.heading('Effects  (capture burst, confetti)', 40, y);
    [14, 32, 52].forEach((r, i) => this.add.circle(90 + i * 110, y + 90, r).setStrokeStyle(5, [COLORS.red, COLORS.yellow, COLORS.blue][i], 0.9 - i * 0.2));
    const confetti = [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, 0xffffff];
    for (let i = 0; i < 30; i++) this.add.rectangle(440 + (i % 10) * 26, y + 55 + Math.floor(i / 10) * 34, 10, 16, confetti[i % 5]).setAngle((i * 47) % 360);

    y = 1400;
    this.heading('Typography', 40, y);
    addText(this, 40, y + 75, 'LUDO', { fontSize: '64px', color: '#ffffff' }).setOrigin(0, 0.5);
    this.label('Picture font (img/spritefont): all text,', 300, y + 50, 20, '#ffffff', true);
    this.label('upper case only, tinted for colour;', 300, y + 80, 20, '#ffffff', true);
    this.label('descriptions use the muted tint', 300, y + 110, 20, '#b0bec5');
    this.label('Status line:  RED (you) rolled 6: pick a token', 40, y + 160, 20, '#e53935', true);
    this.label('Winner banner:  YOU WIN!', 40, y + 195, 20, '#43a047', true);
    this.tweens.killAll();
    this.time.delayedCall(400, () => {
      window.__sheetReady = true;
    });
  }
}

const CELL_STAR = { inner: 6, outer: 15 };

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'sheet',
  width: W,
  height: H,
  backgroundColor: 0x151a26,
  scale: { mode: Phaser.Scale.NONE },
  scene: SheetScene,
});
