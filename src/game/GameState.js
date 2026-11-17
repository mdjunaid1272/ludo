import { PLAYER_IDS, IN_YARD, FINISHED, LAST_TRACK_STEP, SAFE_INDICES, absIndexFor } from './path.js';
import { resolveRules } from './rules.js';

export const TOKENS_PER_PLAYER = 4;

// Where the current turn is. Each engine method is only valid in one phase:
//   ROLL -> rollDice() -> MOVE (a legal move exists) or END (none / forfeited)
//   MOVE -> moveToken() -> END, or GAME_OVER if that move left only one player still playing
//   END  -> endTurn() -> ROLL (same player on a bonus roll, otherwise the next player still playing)
//
// A player who gets all four tokens home is FINISHED: they take the next free position in `rankings` (first to finish is 1st),
// take no more turns, and the others play on. The game is over when only one player is left; that player is put last.
// A player can also LEAVE a running game (removePlayer: their connection was lost for good, or they quit). They are taken out
// completely: their tokens leave the board, they take no more turns, and nobody plays their seat. If that leaves only one player
// the game is over. When the game is over `rankings` has everybody: those who finished, then the player still in, then the players
// who left (the latest to leave first).
// Everything here is about seats (player ids), never about the colour a screen paints them in.
export const PHASE = Object.freeze({ ROLL: 'roll', MOVE: 'move', END: 'end', GAME_OVER: 'gameOver' });

// Pure game rules and state with no Phaser code, so it can be unit tested and reused by
// AI and online play. Token progress values are defined in path.js.
export class GameState {
  constructor({ players = PLAYER_IDS, rules } = {}) {
    if (players.length < 2 || players.length > 4) throw new Error('Ludo needs 2 to 4 players');
    if (new Set(players).size !== players.length || players.some((p) => !PLAYER_IDS.includes(p))) {
      throw new Error(`Invalid players: ${players}`);
    }
    this.rules = resolveRules(rules);
    this.players = [...players];
    this.tokens = {};
    for (const id of this.players) this.tokens[id] = Array(TOKENS_PER_PLAYER).fill(IN_YARD);

    this.turn = 0;
    this.phase = PHASE.ROLL;
    this.winner = null; // the first player to finish (1st place); the game goes on after that unless only one player is left
    this.rankings = []; // seats in the order they finished; when the game is over it holds every seat
    this.left = []; // seats whose player left the game, in the order they left
    this.#resetTurnFlags();
    this.sixesInRow = 0;
  }

  get currentPlayer() {
    return this.players[this.turn];
  }

  // 'left' for a player who left the game, 'finished' once all four tokens are home (or the game is over), otherwise 'playing'.
  statusOf(player) {
    if (this.left.includes(player)) return 'left';
    return this.rankings.includes(player) ? 'finished' : 'playing';
  }

  // True for a player who takes no more turns: finished, or left.
  isOut(player) {
    return this.rankings.includes(player) || this.left.includes(player);
  }

  // 1 for the first to finish, and so on; null while the player is still playing.
  positionOf(player) {
    const i = this.rankings.indexOf(player);
    return i === -1 ? null : i + 1;
  }

  // The players still playing, in seating order.
  get activePlayers() {
    return this.players.filter((p) => !this.isOut(p));
  }

  #resetTurnFlags() {
    this.roll = null;
    this.forfeited = false; // the roll was a voided third six
    this.moved = false;
    this.captureThisTurn = false;
    this.finishedThisMove = false;
    this.completedThisMove = null; // the position the player just took by getting their last token home, if they did
  }

  #assertPhase(expected, action) {
    if (this.phase !== expected) throw new Error(`Cannot ${action} during phase "${this.phase}"`);
  }

  // A plain-data copy of the whole game, for sending over the network (online play) and for tests.
  snapshot() {
    return {
      players: [...this.players],
      rules: { ...this.rules },
      tokens: Object.fromEntries(this.players.map((id) => [id, [...this.tokens[id]]])),
      turn: this.turn,
      phase: this.phase,
      winner: this.winner,
      rankings: [...this.rankings],
      left: [...this.left],
      roll: this.roll,
      sixesInRow: this.sixesInRow,
      forfeited: this.forfeited,
      moved: this.moved,
      captureThisTurn: this.captureThisTurn,
      finishedThisMove: this.finishedThisMove,
    };
  }

  static fromSnapshot(snapshot) {
    const game = new GameState({ players: snapshot?.players, rules: snapshot?.rules });
    game.restore(snapshot);
    return game;
  }

  // Replaces this game's state with a snapshot, after checking that it describes a possible game.
  // Throws (leaving the game unchanged) if the snapshot is malformed, so untrusted data cannot corrupt it.
  restore(snapshot) {
    const s = snapshot;
    const bad = (why) => {
      throw new Error(`Invalid snapshot: ${why}`);
    };
    if (!s || typeof s !== 'object') bad('not an object');
    if (JSON.stringify(s.players) !== JSON.stringify(this.players)) bad('players differ');
    for (const id of this.players) {
      const list = s.tokens?.[id];
      if (!Array.isArray(list) || list.length !== TOKENS_PER_PLAYER) bad(`tokens of ${id}`);
      if (!list.every((p) => Number.isInteger(p) && p >= IN_YARD && p <= FINISHED)) bad(`token progress of ${id}`);
    }
    if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn >= this.players.length) bad('turn');
    if (!Object.values(PHASE).includes(s.phase)) bad('phase');
    if (s.roll !== null && !(Number.isInteger(s.roll) && s.roll >= 1 && s.roll <= 6)) bad('roll');
    if (s.winner !== null && !this.players.includes(s.winner)) bad('winner');
    // Snapshots from before rankings existed have just a winner.
    const rankings = s.rankings === undefined ? (s.winner === null ? [] : s.phase === PHASE.GAME_OVER ? [s.winner, ...this.players.filter((p) => p !== s.winner)] : [s.winner]) : s.rankings;
    const left = s.left === undefined ? [] : s.left;
    if (!Array.isArray(left) || left.some((p) => !this.players.includes(p)) || new Set(left).size !== left.length) bad('left');
    if (s.phase !== PHASE.GAME_OVER && left.some((p) => rankings.includes(p))) bad('a player cannot have finished and left');
    if (!Array.isArray(rankings) || rankings.some((p) => !this.players.includes(p)) || new Set(rankings).size !== rankings.length) bad('rankings');
    if (rankings.length > this.players.length) bad('rankings');
    if ((s.phase === PHASE.GAME_OVER) !== (rankings.length === this.players.length)) bad('rankings do not match the phase');
    if (s.winner !== (rankings[0] ?? null)) bad('winner is not first in the rankings');
    if (s.phase !== PHASE.GAME_OVER && !rankings.every((p) => s.tokens[p].every((t) => t === FINISHED))) bad('ranked players have unfinished tokens');
    if ((s.phase === PHASE.ROLL || s.phase === PHASE.MOVE) && (rankings.includes(this.players[s.turn]) || left.includes(this.players[s.turn]))) bad('turn of a player who is out'); // (in phase END the player who just finished is still waiting for endTurn)
    if (!Number.isInteger(s.sixesInRow) || s.sixesInRow < 0 || s.sixesInRow > 3) bad('sixesInRow');

    for (const id of this.players) this.tokens[id] = [...s.tokens[id]];
    this.turn = s.turn;
    this.phase = s.phase;
    this.winner = s.winner;
    this.rankings = [...rankings];
    this.left = [...left];
    this.roll = s.roll;
    this.sixesInRow = s.sixesInRow;
    this.forfeited = Boolean(s.forfeited);
    this.moved = Boolean(s.moved);
    this.captureThisTurn = Boolean(s.captureThisTurn);
    this.finishedThisMove = Boolean(s.finishedThisMove);
    this.completedThisMove = null;
  }

  // Rolls the die. `rng` must return a number in [0, 1); inject one for tests.
  rollDice(rng = Math.random) {
    this.#assertPhase(PHASE.ROLL, 'roll');
    const roll = 1 + Math.floor(rng() * 6);
    this.roll = roll;
    this.sixesInRow = roll === 6 ? this.sixesInRow + 1 : 0;
    this.forfeited = this.rules.tripleSix === 'forfeit' && this.sixesInRow >= 3;
    this.phase = !this.forfeited && this.#computeLegalMoves().length > 0 ? PHASE.MOVE : PHASE.END;
    return roll;
  }

  // Indexes of the current player's tokens that may move with the current roll.
  legalMoves() {
    return this.phase === PHASE.MOVE ? this.#computeLegalMoves() : [];
  }

  #computeLegalMoves() {
    const me = this.currentPlayer;
    return this.tokens[me].flatMap((progress, i) => (this.#isLegal(me, progress, this.roll) ? [i] : []));
  }

  // A token leaves the yard only on a 6 and must land exactly on the finish.
  #isLegal(color, progress, roll) {
    if (progress === FINISHED) return false;
    if (progress === IN_YARD) return roll === 6 && !(this.rules.blockades && this.#isBlocked(color, 0));
    const to = progress + roll;
    if (to > FINISHED) return false;
    if (this.rules.blockades) {
      for (let step = progress + 1; step <= Math.min(to, LAST_TRACK_STEP); step++) {
        if (this.#isBlocked(color, step)) return false;
      }
    }
    return true;
  }

  // True if another colour holds two or more tokens on the cell `color` would reach at `step`.
  #isBlocked(color, step) {
    const abs = absIndexFor(color, step);
    if (abs === null) return false;
    return this.players.some(
      (other) => other !== color && this.tokens[other].filter((p) => absIndexFor(other, p) === abs).length >= 2,
    );
  }

  // Moves a token and returns { from, to, captured, finished }, where captured lists
  // { player, index } of opponent tokens sent back to their yard.
  moveToken(index) {
    this.#assertPhase(PHASE.MOVE, 'move a token');
    if (!this.#computeLegalMoves().includes(index)) throw new Error(`Illegal move: token ${index}`);

    const me = this.currentPlayer;
    const list = this.tokens[me];
    const from = list[index];
    const to = from === IN_YARD ? 0 : from + this.roll;
    list[index] = to;

    const captured = [];
    const abs = absIndexFor(me, to);
    if (abs !== null && !SAFE_INDICES.has(abs)) {
      for (const other of this.players) {
        if (other === me) continue;
        this.tokens[other].forEach((progress, i) => {
          if (absIndexFor(other, progress) === abs) {
            this.tokens[other][i] = IN_YARD;
            captured.push({ player: other, index: i });
          }
        });
      }
    }

    this.moved = true;
    this.captureThisTurn = captured.length > 0;
    this.finishedThisMove = to === FINISHED;

    this.phase = PHASE.END;
    if (list.every((p) => p === FINISHED)) this.#finishPlayer(me);
    return { from, to, captured, finished: this.finishedThisMove, position: this.completedThisMove };
  }

  // A player leaves the running game. Returns false if there was nothing to do (not in this game, already out, game over).
  // Their tokens go back to the yard (so they block and capture nothing); if it was their turn the turn ends (phase END,
  // no bonus roll) so the next endTurn() passes it on. If one player or none is left the game is over.
  removePlayer(player) {
    if (!this.players.includes(player) || this.isOut(player) || this.phase === PHASE.GAME_OVER) return false;
    const wasTheirTurn = this.currentPlayer === player;
    this.left.push(player);
    this.tokens[player] = Array(TOKENS_PER_PLAYER).fill(IN_YARD);
    const stillIn = this.activePlayers;
    if (stillIn.length <= 1) {
      this.rankings.push(...stillIn, ...[...this.left].reverse());
      this.winner = this.rankings[0] ?? null;
      this.phase = PHASE.GAME_OVER;
    } else if (wasTheirTurn) {
      this.#resetTurnFlags();
      this.phase = PHASE.END;
    }
    return true;
  }

  // `me` has all their tokens home: they take the next position. If only one player is left, that player takes the last
  // position automatically and the game is over.
  #finishPlayer(me) {
    this.rankings.push(me);
    this.completedThisMove = this.rankings.length;
    if (this.winner === null) this.winner = me;
    const left = this.activePlayers;
    if (left.length <= 1) {
      this.rankings.push(...left, ...[...this.left].reverse()); // the player still in, then those who left (the last to leave first)
      this.phase = PHASE.GAME_OVER;
    }
  }

  // Ends the turn. Returns true if the same player rolls again.
  endTurn() {
    this.#assertPhase(PHASE.END, 'end the turn');
    const r = this.rules;
    const out = this.isOut(this.currentPlayer); // someone who has just finished (or left) gets no bonus roll
    const bonus =
      !out &&
      !this.forfeited &&
      ((this.roll === 6 && r.sixGrantsExtra && (this.moved || r.sixWithoutMoveGrantsExtra)) ||
        (this.captureThisTurn && r.captureGrantsExtra) ||
        (this.finishedThisMove && r.finishGrantsExtra));

    this.#resetTurnFlags();
    if (!bonus) {
      this.turn = this.#nextActiveTurn();
      this.sixesInRow = 0;
    }
    this.phase = PHASE.ROLL;
    return bonus;
  }

  // The seat after the current one that is still playing (finished players never get a turn).
  #nextActiveTurn() {
    for (let step = 1; step <= this.players.length; step++) {
      const i = (this.turn + step) % this.players.length;
      if (!this.isOut(this.players[i])) return i;
    }
    throw new Error('Nobody is left to play');
  }
}

