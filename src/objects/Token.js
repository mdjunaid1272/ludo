import { tokenImageKey } from '../config/assets.js';
import { CELL, UI_DEPTH } from '../config/constants.js';
import { layout, MIN_TOUCH } from '../config/layout.js';
import { gridToPixel } from '../board/geometry.js';
import { positionFor } from '../game/path.js';
import { UI } from '../ui/theme.js';

const RADIUS = CELL * 0.34;
const PICTURE = CELL * 1.1; // the size of the square the piece's picture is drawn in (the gold-ringed pawns in img/elements; a pawn is taller than wide)

// A single game piece: shadow, the piece's picture (or, without it, a coloured body, ring and shine) and a "can move" halo, grouped in a
// container. All animation goes through the Animator so it is cancelled safely on shutdown.
export class Token {
  constructor(scene, animator, player, index) {
    this.scene = scene;
    this.animator = animator;
    this.player = player;
    this.index = index;
    this.baseScale = 1;
    this.pulse = null;
    this.haloTween = null;

    // The shadow lies on the board under the foot of the pawn (the picture is drawn centred, so its foot is half a picture below the
    // middle), a little wider than the foot.
    const shadow = scene.add.ellipse(CELL * 0.03, PICTURE * 0.44, PICTURE * 0.8, PICTURE * 0.26, 0x000000, 0.4);
    this.halo = scene.add.circle(0, 0, RADIUS * 1.3).setStrokeStyle(4, UI.accent).setVisible(false);
    // The piece is drawn in the colour this screen paints the seat in (player.colorId; see config/palette.js).
    const key = tokenImageKey(player.colorId ?? player.id);
    let looks;
    if (scene.textures?.exists?.(key)) {
      looks = [scene.add.image(0, 0, key).setDisplaySize(PICTURE, PICTURE)];
    } else {
      const body = scene.add.circle(0, 0, RADIUS, player.color).setStrokeStyle(4, 0x1b1f2a);
      const ring = scene.add.circle(0, 0, RADIUS * 0.62).setStrokeStyle(2, 0xffffff, 0.55);
      const shine = scene.add.circle(-RADIUS * 0.35, -RADIUS * 0.4, RADIUS * 0.22, 0xffffff, 0.45);
      looks = [body, ring, shine];
    }

    // The container is the touch target: at least a cell wide, and large enough to tap comfortably when
    // the screen scales the board down (capped so neighbouring cells do not overlap too much).
    const hit = Math.min(CELL * 1.7, Math.max(CELL, MIN_TOUCH / layout.scale));
    this.view = scene.add.container(0, 0, [shadow, this.halo, ...looks]).setSize(hit, hit).setDepth(UI_DEPTH.token);
    this.placeAt(-1);
  }

  pixelFor(progress) {
    const { gx, gy } = positionFor(this.player.id, progress, this.index);
    return gridToPixel(gx, gy);
  }

  placeAt(progress) {
    const { x, y } = this.pixelFor(progress);
    this.view.setPosition(x, y);
  }

  // Hops through each progress value in turn.
  async moveAlong(progressSteps) {
    this.view.setDepth(UI_DEPTH.tokenMoving);
    for (const progress of progressSteps) {
      const { x, y } = this.pixelFor(progress);
      await Promise.all([
        this.animator.tween(this.view, { x, y }, 140),
        this.animator.tween(this.view, { scale: this.baseScale * 1.2, yoyo: true }, 70),
      ]);
    }
    this.view.setDepth(UI_DEPTH.token);
  }

  // Quick blink, used when this token is captured.
  flash() {
    return this.animator.tween(this.view, { alpha: 0.15, yoyo: true, repeat: 1 }, 90);
  }

  // Moves to a final resting spot, shrunk and offset when sharing a cell with other tokens.
  settle(x, y, scale, animate = true) {
    this.baseScale = scale;
    if (!animate) {
      this.view.setPosition(x, y).setScale(scale);
      return Promise.resolve();
    }
    return this.animator.tween(this.view, { x, y, scale }, 120);
  }

  // Makes the token clickable with a glowing halo, or inert again.
  setMovable(movable, { onClick, onHover } = {}) {
    this.pulse?.stop();
    this.haloTween?.stop();
    this.pulse = this.haloTween = null;
    this.view.removeAllListeners('pointerdown').removeAllListeners('pointerover').removeAllListeners('pointerout');
    this.view.disableInteractive().setScale(this.baseScale);
    this.halo.setVisible(false);
    if (!movable) return;

    // Without a click handler (a computer's pick) the token is highlighted but not clickable.
    if (onClick) {
      this.view.setInteractive({ useHandCursor: true });
      this.view.on('pointerdown', () => onClick());
      this.view.on('pointerover', () => onHover?.(true));
      this.view.on('pointerout', () => onHover?.(false));
    }
    this.halo.setVisible(true).setAlpha(1);
    this.haloTween = this.scene.tweens.add({ targets: this.halo, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    this.pulse = this.scene.tweens.add({ targets: this.view, scale: this.baseScale * 1.15, duration: 450, yoyo: true, repeat: -1 });
  }
}

