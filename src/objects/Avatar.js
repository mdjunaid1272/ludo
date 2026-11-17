import Phaser from 'phaser';
import { AVATAR_ACTIVE_SCALE, AVATAR_RING as RING, AVATAR_TIMER } from '../config/layout.js';
import { medalColor } from '../ui/ranking.js';
import { addText } from '../ui/SpriteText.js';

const DIM = 0.55; // how faded an avatar is when it is not that player's turn
const ARC_WIDTH = 6; // width of the countdown arc, in game pixels
const TIMER_COLOR = 0xffffff; // the countdown arc is white

// A player's picture with a ring in the player's colour, so it is clear which yard it belongs to. The picture is fitted
// into a box `size` wide; the ring follows its outline (the pictures are slightly oval). setTurn() brightens the avatar of
// the player whose turn it is and fades the others. startTimer() draws a countdown arc around the avatar that shrinks
// (clockwise from the top, so the arc empties as time passes) over the time given.
export class Avatar extends Phaser.GameObjects.Container {
  constructor(scene, x, y, { textureKey, size, color }) {
    super(scene, x, y);
    const picture = scene.add.image(0, 0, textureKey);
    picture.setScale(size / picture.width);
    const w = picture.displayWidth;
    const h = picture.displayHeight;
    const ring = scene.add.ellipse(0, 0, w + RING, h + RING).setStrokeStyle(RING, color);
    this.arcRadius = Math.max(w, h) / 2 + RING + (AVATAR_TIMER - ARC_WIDTH / 2 - 0.5);
    this.arc = scene.add.graphics();
    this.add([ring, picture, this.arc]);
    this.setSize(w, h);
    this.picture = { w, h };
    this.badge = null;
    this.countdown = null;
    scene.add.existing(this);
    this.setTurn(false);
  }

  setTurn(active) {
    this.setAlpha(active ? 1 : DIM);
    this.setScale(active ? AVATAR_ACTIVE_SCALE : 1);
    return this;
  }

  // Marks a player who has finished: a medal with their position at the top corner of the picture. null removes it.
  setRank(position) {
    this.badge?.forEach((item) => item.destroy());
    this.badge = null;
    if (!position) return this;
    const r = Math.max(this.picture.w * 0.24, 9);
    const x = this.picture.w / 2 - r * 0.2;
    const y = -this.picture.h / 2 + r * 0.2;
    const disc = this.scene.add.circle(x, y, r, medalColor(position)).setStrokeStyle(2, 0x1b1f2a);
    const digit = addText(this.scene, x, y, String(position), { fontSize: `${r * 1.2}px`, color: '#ffffff' }).setOrigin(0.5);
    this.add([disc, digit]);
    this.badge = [disc, digit];
    return this;
  }

  // Starts (or restarts) the countdown: the arc is full now and is gone after `ms`.
  startTimer(ms) {
    this.stopTimer();
    if (!(ms > 0)) return this;
    this.countdown = this.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: ms,
      onUpdate: (tween) => this.drawArc(tween.getValue()),
      onComplete: () => this.stopTimer(),
    });
    this.drawArc(1);
    return this;
  }

  stopTimer() {
    this.countdown?.remove();
    this.countdown = null;
    this.arc?.clear();
    return this;
  }

  // The arc for `fraction` (1 = all the time left, 0 = none) of the full circle.
  drawArc(fraction) {
    const g = this.arc;
    g.clear();
    if (fraction <= 0) return;
    const start = -Math.PI / 2; // the top
    g.lineStyle(ARC_WIDTH, TIMER_COLOR, 1);
    g.beginPath();
    g.arc(0, 0, this.arcRadius, start, start + Math.PI * 2 * fraction, false);
    g.strokePath();
  }
}