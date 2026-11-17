import { PLAYERS } from '../config/constants.js';
import { IDENTITY_PALETTE } from '../config/palette.js';
import { gridToPixel } from '../board/geometry.js';
import { tokenKey } from '../game/tokenLayout.js';
import { Token } from './Token.js';

// The tokens of the players in this game, with helpers to place them from a computed layout
// and to mark movable ones.
export class TokenSet {
  constructor(scene, animator, playerIds, palette = IDENTITY_PALETTE) {
    this.tokens = {};
    for (const player of PLAYERS.filter((p) => playerIds.includes(p.id))) {
      this.tokens[player.id] = [0, 1, 2, 3].map((i) => new Token(scene, animator, palette.entry(player.id), i));
    }
  }

  // Moves every token to its slot in `slots` (Map from computeTokenSlots).
  settle(slots, animate = true) {
    const jobs = [];
    for (const [id, list] of Object.entries(this.tokens)) {
      list.forEach((token, i) => {
        const { gx, gy, scale } = slots.get(tokenKey(id, i));
        const { x, y } = gridToPixel(gx, gy);
        jobs.push(token.settle(x, y, scale, animate));
      });
    }
    return Promise.all(jobs);
  }

  moveAlong(color, index, progressSteps) {
    return this.tokens[color][index].moveAlong(progressSteps);
  }

  get(color, index) {
    return this.tokens[color][index];
  }

  // Makes exactly the tokens in `indexes` of `color` clickable; everything else is inert.
  setMovable(color, indexes, { onPick, onHover }) {
    for (const list of Object.values(this.tokens)) list.forEach((t) => t.setMovable(false));
    for (const i of indexes) {
      this.tokens[color][i].setMovable(true, {
        onClick: onPick ? () => onPick(i) : undefined,
        onHover: onHover ? (on) => onHover(i, on) : undefined,
      });
    }
  }
}


