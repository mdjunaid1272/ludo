import Phaser from 'phaser';
import { drawBoard } from '../src/board/drawBoard.js';
import { drawSafeCells } from '../src/board/drawSafeCells.js';
import { SPRITE_FONTS } from '../src/config/assets.js';
import { COLORS, PLAYERS } from '../src/config/constants.js';
import { layout } from '../src/config/layout.js';
import { Dice } from '../src/objects/Dice.js';
import { Token } from '../src/objects/Token.js';

// Development tool: draws each game asset on a transparent canvas, at 3x, and reports where each one is
// (window.__assets, in canvas pixels) so a script can capture every asset as its own PNG.
// Open /tools/export.html while `npm run dev` is running. (Not part of the production build.)
const ZOOM = 3;
const W = 1000;
const H = 1100;
const still = { tween: () => Promise.resolve(), delay: () => Promise.resolve() };

class ExportScene extends Phaser.Scene {
  constructor() {
    super('ExportScene');
  }

  preload() {
    for (const { key, png, xml } of SPRITE_FONTS) this.load.bitmapFont(key, png, xml); // the yard names on the board
  }

  create() {
    const assets = [];
    const add = (name, x, y, w, h) => assets.push({ name, x: x * ZOOM, y: y * ZOOM, w: w * ZOOM, h: h * ZOOM });

    // The camera zooms around its centre; scroll so that world (0,0) is the top-left of the canvas.
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setScroll((W * ZOOM / 2) * (1 / ZOOM - 1), (H * ZOOM / 2) * (1 / ZOOM - 1));

    // Board: 720 x 720, empty (no tokens), with the stars and arrows.
    layout.boardX = 0;
    layout.boardY = 0;
    drawBoard(this);
    drawSafeCells(this); // the white and dark stars on the start and safe cells
    add('board', 0, 0, 720, 720);

    // Tokens: normal and "can move" (halo), per colour. 64 x 64 around the token centre.
    PLAYERS.forEach((player, i) => {
      const cx = 60 + i * 150;
      new Token(this, still, player, 0).settle(cx, 790, 1, false);
      add(`token-${player.id}`, cx - 32, 790 - 32, 64, 64);

      const movable = new Token(this, still, player, 1);
      movable.settle(cx, 880, 1, false);
      movable.setMovable(true, { onClick() {} });
      movable.pulse.stop();
      movable.haloTween.stop();
      movable.view.setScale(1);
      movable.halo.setAlpha(1);
      add(`token-${player.id}-movable`, cx - 32, 880 - 32, 64, 64);
    });

    // Dice faces 1-6: the die is 72 x 72 with a soft shadow, so use a 96 x 96 frame.
    for (let v = 1; v <= 6; v++) {
      const cx = 60 + (v - 1) * 150;
      const die = new Dice(this, still, cx, 990, 72);
      die.setValue(v);
      add(`dice-${v}`, cx - 48, 990 - 48, 96, 96);
    }

    // Star markers used on the board's safe cells.
    this.add.star(60, 1080, 5, 6, 15, 0xffffff).setStrokeStyle(2, 0x2b2f3a);
    add('star-white', 60 - 20, 1080 - 20, 40, 40);
    this.add.star(210, 1080, 5, 6, 15, COLORS.line);
    add('star-dark', 210 - 20, 1080 - 20, 40, 40);

    // Text is rendered at the zoom level too, so the labels on the board stay sharp.
    for (const child of this.children.list) child.setResolution?.(ZOOM);

    this.tweens.killAll();
    window.__assets = assets;
    window.__zoom = ZOOM;
    this.time.delayedCall(400, () => {
      window.__exportReady = true;
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'export',
  width: W * ZOOM,
  height: H * ZOOM,
  transparent: true,
  scale: { mode: Phaser.Scale.NONE },
  scene: ExportScene,
});
