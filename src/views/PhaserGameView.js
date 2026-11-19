import { UI_DEPTH } from '../config/constants.js';
import { IDENTITY_PALETTE } from '../config/palette.js';
import { BOARD, layout } from '../config/layout.js';
import { gridRect, gridToPixel } from '../board/geometry.js';
import { computeTokenSlots } from '../game/tokenLayout.js';
import { YARD_CORNER, positionFor } from '../game/path.js';
import { Avatar } from '../objects/Avatar.js';
import { Dice } from '../objects/Dice.js';
import { Effects } from '../objects/Effects.js';
import { ReactionBubbles } from '../objects/ReactionBubbles.js';
import { MoveHints } from '../objects/MoveHints.js';
import { TokenSet } from '../objects/TokenSet.js';
import { FinishPopup } from '../ui/FinishPopup.js';
import { Hud } from '../ui/Hud.js';
import { ordinal } from '../ui/ranking.js';
import { ResultsDialog } from '../ui/ResultsDialog.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

// The Phaser implementation of the TurnController's view. It owns the HUD, die, tokens, move
// hints and effects, reads game state only to compute positions, and forwards clicks as callbacks.
const NAME_DIM = 0.8; // how faded the names of players who are not on turn are

export class PhaserGameView {
  // `computers` lists the players the computer controls; `vsComputer` is true in Player vs Computer mode
  // (where the remaining player is labelled "you"). In an online game `you` is this person's colour instead.
  // `endButtons()` can replace the game-over dialog's buttons (online play offers Rematch instead of Play again).
  // `avatars` maps each colour to the key of its avatar picture.
  // `names` (online games) maps each seat to the player's name; it is shown by the avatar, in the status line and on the
  // winner dialog. Names belong to seats, so every screen shows the same name for a seat whatever colour it paints it in.
  constructor(scene, animator, state, {
    onRoll, onPick, onRestartRequest, onMenuRequest, onPlayAgain, onExit,
    computers = [], vsComputer = false, you = null, endButtons = null, restartEnabled = true, avatars = {}, palette = IDENTITY_PALETTE, names = null, pauseOnFinish = true, onChat = null,
  }) {
    this.scene = scene;
    this.palette = palette; // how each seat is painted on this screen (online: everybody's own choice of colour)
    this.state = state;
    this.animator = animator;
    this.onPick = onPick;
    this.onPlayAgain = onPlayAgain;
    this.onExit = onExit;
    this.computers = new Set(computers);
    this.vsComputer = vsComputer;
    this.you = you;
    this.names = names;
    this.avatarKeys = avatars;
    this.pauseOnFinish = pauseOnFinish; // true: the game waits for Continue after somebody finishes; online it cannot wait
    this.endButtons = endButtons;

    this.hud = new Hud(scene, { onRestart: onRestartRequest, onMenu: onMenuRequest, restartEnabled, onChat });
    this.tokens = new TokenSet(scene, animator, state.players, palette);
    this.hints = new MoveHints(scene);
    this.effects = new Effects(scene);
    const spot = this.diceSpot(state.currentPlayer);
    this.dice = new Dice(scene, animator, spot.x, spot.y, layout.hud.dice.size);
    this.dice.on('click', onRoll);
    this.tokens.settle(computeTokenSlots(state.tokens), false);

    // Each player's avatar stands at the outer edge of the die's row on its yard's side, as the yard appears on screen.
    this.avatars = new Map();
    this.nameTags = new Map(); // seat -> the text with that player's name, next to the avatar
    const slots = layout.hud.avatar;
    for (const color of slots ? state.players : []) {
      const textureKey = avatars[color];
      if (!textureKey || !scene.textures.exists(textureKey)) continue;
      const { right, below } = this.quadrant(color);
      const at = slots.slot(right, below);
      this.avatars.set(color, new Avatar(scene, at.x, at.y, { textureKey, size: slots.size, color: palette.color(color) }));
      const nameAt = names ? slots.nameSlot(right, below) : null;
      if (nameAt && nameAt.font === undefined) nameAt.font = slots.nameFont; // (the landscape layout uses one size for all)
      if (nameAt) this.nameTags.set(color, addText(scene, nameAt.x, nameAt.y, '', { fontSize: `${nameAt.font}px`, color: '#ffffff' }).setOrigin(nameAt.originX, 0.5));
    }
    this.showNames();
    this.showRanks(state.rankings); // after a rebuilt screen, players who already finished show their medal
    for (const seat of state.left) this.showLeft(seat); // ...and players who left the game show as gone
    this.avatars.get(state.currentPlayer)?.setTurn(true);
  }

  // "(CPU)" for computer players, "(you)" for this person in Player vs Computer and online games.
  tag(player) {
    if (this.names) return player === this.you ? ' (you)' : ''; // a computer's seat is already called Computer
    if (this.computers.has(player)) return ' (CPU)';
    if (this.you) return player === this.you ? ' (you)' : '';
    return this.vsComputer ? ' (you)' : '';
  }

  // Online: the seats can change during a game (someone leaves and the computer takes over).
  setSeats({ computers, names }) {
    this.computers = new Set(computers);
    if (names && this.names) {
      this.names = names;
      this.showNames();
    }
  }

  // Online: somebody sent a quick chat message, reaction or emoji (an entry of REACTIONS); it shows next to their avatar.
  showReaction(seat, reaction, name) {
    this.reactions ??= new ReactionBubbles(this.scene, { anchorOf: (s) => this.reactionAnchor(s) });
    return this.reactions.show(seat, reaction, { name, color: this.palette.color(seat) });
  }

  // Where a seat's reactions appear: its avatar, or (on screens without avatars) the spot where its die stands.
  reactionAnchor(seat) {
    if (!this.state.players.includes(seat)) return null;
    const avatar = this.avatars.get(seat);
    if (avatar) return { x: avatar.x, y: avatar.y, size: layout.hud.avatar.size * 1.2 };
    const spot = this.diceSpot(seat);
    return { x: spot.x, y: spot.y, size: layout.hud.dice.size };
  }

  // A player left the running game: their tokens are gone from the board, their yard is greyed out, and their avatar and name are
  // faded and marked as left. Safe to call again.
  showLeft(seat) {
    if (!this.state.players.includes(seat)) return;
    this.leftYards ??= new Map();
    for (const token of this.tokens.tokens[seat] ?? []) token.view.setVisible(false);
    if (!this.leftYards.has(seat)) {
      const [corner, row] = YARD_CORNER[seat];
      const yard = gridRect(corner, row, 6, 6);
      this.leftYards.set(seat, this.scene.add.rectangle(yard.x + yard.w / 2, yard.y + yard.h / 2, yard.w, yard.h, 0x1b1f2a, 0.7).setDepth(UI_DEPTH.marker));
    }
    this.avatars.get(seat)?.setAlpha(0.3);
    this.showNames();
  }

  // Puts a medal with the position on the avatar of every player who has finished, and greys them out for good.
  showRanks(rankings) {
    for (const [seat, avatar] of this.avatars) {
      const position = rankings.indexOf(seat) + 1;
      avatar.setRank(position || null);
    }
  }

  // Somebody got their last token home and the game goes on. A message in the status line, then the popup with their
  // position; the game waits for Continue (on one device) or carries on at once (online, where the popup closes by itself).
  showFinished(player, position) {
    this.showRanks(this.state.rankings);
    this.say(player, ` finished ${ordinal(position)}!`);
    this.finish?.close();
    return new Promise((resolve) => {
      const popup = new FinishPopup(this.scene, {
        name: `${this.nameOf(player)}${this.tag(player)}`,
        avatarKey: this.avatarKeys[player],
        position,
        color: this.palette.color(player),
        modal: this.pauseOnFinish,
        autoCloseMs: this.pauseOnFinish ? 0 : 4500,
        onClose: () => {
          if (this.finish === popup) this.finish = null;
          if (this.pauseOnFinish) resolve();
        },
      });
      this.finish = popup;
      if (!this.pauseOnFinish) resolve();
    });
  }

  // What to call a player: their name online, otherwise their colour.
  nameOf(player) {
    return this.names?.[player] ?? this.palette.label(player);
  }

  // Writes each seat's name under its avatar. Names are white (the picture font's own outline keeps them readable on the dark
  // background; colours like blue or green were not), and the one whose turn it is stands out.
  showNames() {
    for (const [seat, tag] of this.nameTags) {
      tag.setText(`${this.nameOf(seat)}${this.state.left.includes(seat) ? ' (left)' : ''}`);
      tag.setAlpha(seat === this.state.currentPlayer ? 1 : NAME_DIM);
    }
  }

  // Somebody else is choosing a token (another person online, or a computer).
  showWaiting(player, value) {
    this.say(player, ` rolled ${value}: choosing...`);
  }

  say(player, text) {
    this.hud.setStatus(`${this.nameOf(player)}${this.tag(player)}${text}`, this.palette.textColor(player));
  }

  // Which corner of the screen a player's yard is in (the board may be turned): { right, below }.
  quadrant(player) {
    const [corner, row] = YARD_CORNER[player];
    const yard = gridToPixel(corner + 3, row + 3);
    return { right: yard.x > layout.boardX + BOARD / 2, below: yard.y > layout.boardY + BOARD / 2 };
  }

  // Where the die stands for `player`: next to that player's yard, as it appears on screen (above or below the board, on
  // the yard's side).
  diceSpot(player) {
    const { right, below } = this.quadrant(player);
    return layout.hud.diceSpot(right, below);
  }

  // A new turn: the die appears next to the player's yard (growing from nothing), takes the player's colour (and glows when it is ready).
  // No text is shown for it; the status line only reports what happens during the turn (captures, a win).
  showTurn(player, _extra) {
    const spot = this.diceSpot(player);
    this.dice.appear(spot.x, spot.y); // the die grows from nothing next to the player whose turn it is
    this.dice.setOwner(this.palette.color(player));
    for (const [color, avatar] of this.avatars) {
      if (this.state.left.includes(color)) continue; // players who left stay faded
      avatar.setTurn(color === player);
      this.nameTags.get(color)?.setAlpha(color === player ? 1 : NAME_DIM); // the player whose turn it is stands out
    }
    this.hud.setStatus('', this.palette.textColor(player));
  }

  setRollEnabled(enabled) {
    this.dice.setReady(enabled);
  }

  // Online: the countdown for the person whose move it is, drawn as an arc on that player's avatar (every other
  // avatar's countdown is cleared). Screens with no avatars show none.
  startTurnTimer(player, ms) {
    this.stopTurnTimer();
    this.avatars.get(player)?.startTimer(ms);
  }

  stopTurnTimer() {
    for (const avatar of this.avatars.values()) avatar.stopTimer();
  }

  // Highlights the movable tokens and marks where each would land. With `interactive` false (a computer's
  // pick) the highlight is shown but the token cannot be clicked.
  setMovable(indexes, interactive = true) {
    const color = this.state.currentPlayer;
    this.hints.clear();
    this.tokens.setMovable(color, indexes, {
      onPick: interactive ? this.onPick : undefined,
      onHover: interactive ? (i, on) => this.hints.highlight(`${color}-${i}`, on) : undefined,
    });
    this.hints.show(
      indexes.map((i) => {
        const from = this.state.tokens[color][i];
        const to = from === -1 ? 0 : from + this.state.roll;
        const { gx, gy } = positionFor(color, to, i);
        return { key: `${color}-${i}`, ...gridToPixel(gx, gy), color: this.palette.color(color) };
      }),
    );
  }

  showRollResult(value) {
    this.dice.setValue(value);
  }

  async animateRoll(value) {
    await this.dice.showRoll(value);
  }

  // The player must choose a token. No text is written for it: the movable tokens are highlighted and the die shows the roll.
  showPickToken(player, _value) {
    this.hud.setStatus('', this.palette.textColor(player));
  }

  // A computer has chosen a token: show it, and where it will land, before it moves.
  showAiPick(index) {
    this.hud.setStatus('', this.palette.textColor(this.state.currentPlayer)); // no text: the chosen token is highlighted
    this.setMovable([index], false);
  }

  // The roll had no legal move. Nothing is written for an ordinary "no moves" (the die shows the number and the turn
  // passes); losing the turn for a third 6 in a row is still explained.
  showNoMoves(player, value, forfeited) {
    if (forfeited) this.say(player, ` rolled ${value}: 3rd 6, turn lost`);
    else this.hud.setStatus('', this.palette.textColor(player));
  }

  pause(ms) {
    return this.animator.delay(ms);
  }

  animateMove(player, index, from, to) {
    const steps = from === -1 ? [0] : Array.from({ length: to - from }, (_, k) => from + 1 + k);
    return this.tokens.moveAlong(player, index, steps);
  }

  announceCapture(player, captured) {
    const victims = [...new Set(captured.map((c) => this.nameOf(c.player)))].join(', ');
    this.say(player, ` captured ${victims}!`);
  }

  // Each captured token flashes where it stood, a ring bursts out, then it hops back to its yard.
  async animateCaptures(captured) {
    this.effects.shake();
    await Promise.all(
      captured.map(async (c) => {
        const token = this.tokens.get(c.player, c.index);
        this.effects.burst(token.view.x, token.view.y, this.palette.color(c.player));
        await token.flash();
        await token.moveAlong([-1]);
      }),
    );
  }

  async settle() {
    await this.tokens.settle(computeTokenSlots(this.state.tokens));
  }

  // Every position is decided: confetti, then the final results with everybody in finishing order. `player` is the winner (1st).
  async showWinner(player) {
    this.finish?.close(); // a "finished" popup that is still up
    this.showRanks(this.state.rankings);
    this.say(player, ` finished ${ordinal(1)}!`);
    this.effects.confetti();
    await this.animator.delay(1100);
    this.results?.close();
    this.results = new ResultsDialog(this.scene, {
      rows: this.state.rankings.map((seat, i) => ({
        name: `${this.nameOf(seat)}${this.tag(seat)}${this.state.left.includes(seat) ? ' (left)' : ''}`,
        avatarKey: this.avatarKeys[seat],
        color: this.palette.color(seat),
        position: i + 1,
      })),
      buttons: this.endButtons?.() ?? [
        { label: 'Play again', color: UI.ok, onClick: this.onPlayAgain },
        { label: 'Home', color: UI.neutral, onClick: this.onExit },
      ],
    });
  }
}


