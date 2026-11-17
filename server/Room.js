import { randomBytes } from 'node:crypto';
import { chooseMove } from '../src/game/ai.js';
import { GameState, PHASE } from '../src/game/GameState.js';
import { botName } from '../src/game/botNames.js';
import { validateName } from '../src/game/playerName.js';
import { COOLDOWN_MS, cooldownGroup, reactionById } from '../src/online/reactions.js';
import { PLAYER_IDS } from '../src/game/path.js';
import { resolveRules } from '../src/game/rules.js';

// One online game room: a lobby where people take seats, then the game itself.
//
// The server is authoritative: only this class runs the game engine. Clients send intentions ("roll",
// "move token 2"); the Room checks they are allowed, applies them, and broadcasts the results, so nobody can
// cheat and every client stays in step. The Room has no sockets in it: it talks to each member through a
// `conn` object with a send(message) method, and takes its clock and random numbers as inputs, so it can be
// tested without a network or real waiting.

export const DEFAULT_CONFIG = Object.freeze({
  turnTimeoutMs: 15_000, // a person who does not act within this long is played for by the computer (clients show a countdown)
  awayTimeoutMs: 15_000, // the time a person gets on the turns after they have timed out once (the same, so the countdown is always 15 s)
  disconnectGraceMs: 8_000, // the computer waits this long before playing for someone whose connection dropped
  disconnectLeaveMs: 10_000, // in a game, someone who has been offline this long has left: the computer keeps their seat for good
  aiThinkMs: 900, // a computer waits this long before rolling...
  aiPickMs: 700, // ...and this long before moving, so people can follow
  aiThinkMinMs: 2_000, // a computer seat waits a random time between these two before it rolls, like a person thinking
  aiThinkMaxMs: 5_000, // (set both to null to use the fixed aiThinkMs instead)
  lobbyGraceMs: 60_000, // a disconnected person keeps their lobby seat this long
  autoSingleMove: true, // when a connected person has only one legal move, the server plays it for them
  matchWaitMs: 20_000, // "Play online": how long a room waits for other people before computers fill the empty seats
  matchStartDelayMs: 1_200, // ...and the short pause between the last seat filling and the game starting
  matchBotsFromMs: [5_000, 8_000], // when this much of the wait is left (a random time in the range), computers start taking the
  //                                  empty seats one by one, so the room fills up like people arriving (null: all at the deadline)
});

// With two players in a "Play online" match, the second seat is opposite the first.
const TWO_PLAYER_ORDER = ['red', 'yellow', 'green', 'blue'];

export const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

const newToken = () => randomBytes(18).toString('base64url'); // 24 URL-safe characters
// A person's public id: shown to everybody in the room so seats can be told apart, but useless for rejoining (that needs the
// secret token). Names are not ids: several people may have the same one.
const newPlayerId = () => randomBytes(6).toString('hex');
const DEFAULT_NAME = 'Player';

export class Room {
  #timer = null;
  #matchTimer = null; // "Play online": fires when the wait for other people is over
  #botTimer = null; // "Play online": the next computer that takes an empty seat before the wait is over
  #startTimer = null; // "Play online": the game starts shortly after the last seat is taken

  // `matchmaking` rooms are public "Play online" rooms: nobody manages them. They start by themselves when full,
  // or after config.matchWaitMs with computers in the empty seats.
  constructor({ code, seats, rules, difficulty = 'normal', clock = realClock, rng = Math.random, config = {}, makeToken = newToken, makeId = newPlayerId, thinkRng = Math.random, matchmaking = false }) {
    this.code = code;
    this.maxSeats = seats;
    this.rules = { ...resolveRules(rules) };
    this.difficulty = difficulty;
    this.clock = clock;
    this.rng = rng;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.makeToken = makeToken;
    this.makeId = makeId;
    this.thinkRng = thinkRng; // its own random numbers, so the bots' waiting never changes the dice

    this.phase = 'lobby'; // 'lobby' | 'playing' | 'over'
    // token -> { token, id, name, color, preferred, conn, host, away, dropTimer }. `color` is the SEAT (where and in what order the person plays);
    // `preferred` is the colour they asked for, which only their own screen uses to paint their seat (src/game/perspective.js).
    this.members = new Map();
    this.leftNames = new Map(); // seat -> name of a person who left the running game (their seat is gone, not taken over)
    this.botNames = new Map(); // colour -> the made-up username a computer seat shows (kept, so it does not change mid-game)
    this.ais = new Set(); // colours played by the computer (added by the host, or left behind by someone who quit)
    this.state = null;
    this.seq = 0; // numbers every game event so clients can apply them in order
    this.idleSince = clock.now(); // when nobody was last connected (for cleanup)
    this.autoTurn = null; // the colour whose current turn the computer already started for them (finish it quickly)
    this.waitKey = null; // identifies the wait for a person that is counting down now (see #schedule)
    this.waitEndsAt = null; // when that wait ends (the room's clock), so a snapshot can say how much time is left
    this.matchmaking = matchmaking;
    this.deadlineAt = null; // when a matchmaking room stops waiting for people
    if (matchmaking) {
      this.deadlineAt = clock.now() + this.config.matchWaitMs;
      this.#matchTimer = clock.setTimeout(() => this.#matchDeadline(), this.config.matchWaitMs);
      this.#scheduleBotArrivals();
    }
  }

  // True if a "Play online" player asking for `size` seats may be put in this room.
  isOpenForMatch(size) {
    return this.matchmaking && this.phase === 'lobby' && this.maxSeats === size && this.occupiedColors().length < this.maxSeats;
  }

  // --- seats -----------------------------------------------------------------------------------

  occupiedColors() {
    return PLAYER_IDS.filter((c) => this.ais.has(c) || [...this.members.values()].some((m) => m.color === c));
  }

  #freeColor() {
    const taken = new Set(this.occupiedColors());
    const order = this.matchmaking && this.maxSeats === 2 ? TWO_PLAYER_ORDER : PLAYER_IDS;
    return order.find((c) => !taken.has(c)) ?? null;
  }

  #memberOf(color) {
    return [...this.members.values()].find((m) => m.color === color) ?? null;
  }

  connectedCount() {
    return [...this.members.values()].filter((m) => m.conn).length;
  }

  // True once nobody is left to play: no people in the room at all.
  isEmpty() {
    return this.members.size === 0;
  }

  // The view of the room a client gets, personalised with their own colour.
  info(member) {
    return {
      code: this.code,
      phase: this.phase,
      maxSeats: this.maxSeats,
      rules: { ...this.rules },
      difficulty: this.difficulty,
      matchmaking: this.matchmaking,
      matchMsLeft: this.matchmaking && this.deadlineAt !== null ? Math.max(0, this.deadlineAt - this.clock.now()) : null,
      you: member?.color ?? null,
      youPreferred: member?.preferred ?? null,
      youId: member?.id ?? null,
      seats: [...this.occupiedColors(), ...(this.state ? this.state.left : [])].map((color) => {
        if (this.state?.left.includes(color)) {
          // Someone who left the running game: nobody plays this seat any more. Kept in the list so everybody can show it as left.
          return { color, status: 'left', position: this.state.positionOf(color), kind: 'left', id: null, name: this.leftNames.get(color) ?? color, host: false, connected: false, away: false };
        }
        const m = this.#memberOf(color);
        return { color, status: this.#statusOf(color), position: this.state?.positionOf(color) ?? null, kind: m ? 'human' : 'ai', id: m?.id ?? null, name: m ? m.name : this.#botName(color), host: Boolean(m?.host), connected: m ? Boolean(m.conn) : true, away: Boolean(m?.away) };
      }),
    };
  }

  // A computer seat looks like any other player: an ordinary username, different from everybody else's, chosen once per seat.
  #botName(color) {
    if (!this.botNames.has(color)) {
      const taken = [...[...this.members.values()].map((m) => m.name), ...this.botNames.values()];
      this.botNames.set(color, botName(`${this.code}:${color}`, taken));
    }
    return this.botNames.get(color);
  }

  // 'waiting' in the lobby; in a game 'playing' until all four tokens are home, then 'finished'.
  #statusOf(color) {
    return this.state && this.phase !== 'lobby' ? this.state.statusOf(color) : 'waiting';
  }

  // --- messaging -------------------------------------------------------------------------------

  #send(conn, message) {
    if (!conn) return;
    try {
      conn.send(message);
    } catch {
      // a dead connection is cleaned up when its socket reports the close
    }
  }

  #error(conn, code, message) {
    this.#send(conn, { t: 'error', code, message });
  }

  #broadcast(message) {
    for (const m of this.members.values()) this.#send(m.conn, message);
  }

  #broadcastRoom() {
    for (const m of this.members.values()) this.#send(m.conn, { t: 'room', room: this.info(m) });
  }

  #snapshotMessage(type) {
    return { t: type, snapshot: this.state.snapshot(), seq: this.seq, ...(this.waitEndsAt === null ? {} : { timeoutMs: Math.max(0, this.waitEndsAt - this.clock.now()) }) };
  }

  // --- joining and leaving ---------------------------------------------------------------------

  // True if no one sits in color yet.
  colorFree(color) {
    return PLAYER_IDS.includes(color) && !this.occupiedColors().includes(color);
  }

  // A new person takes the seat of the colour they asked for if it is free, otherwise the first free seat; either way their
  // preferred colour is remembered (several people may ask for the same one: their screens each paint their own seat in it).
  // Returns { token } or { error }.
  join(conn, wantedColor = null, name = null) {
    if (this.phase !== 'lobby') return { error: { code: 'in_progress', message: 'That game has already started.' } };
    if (this.occupiedColors().length >= this.maxSeats) return { error: { code: 'room_full', message: 'That room is full.' } };
    const color = wantedColor && this.colorFree(wantedColor) ? wantedColor : this.#freeColor();
    const checked = validateName(name);
    const member = { token: this.makeToken(), id: this.makeId(), name: checked.ok ? checked.name : DEFAULT_NAME, color, preferred: PLAYER_IDS.includes(wantedColor) ? wantedColor : color, conn, host: this.members.size === 0, away: false, dropTimer: null };
    this.members.set(member.token, member);
    this.idleSince = null;
    this.#send(conn, { t: 'joined', code: this.code, token: member.token, color: member.color, preferred: member.preferred, id: member.id, name: member.name });
    this.#matchCheck();
    this.#broadcastRoom();
    return { token: member.token };
  }

  // A person comes back with their secret token (after a dropped connection or a page reload).
  rejoin(conn, token) {
    const member = this.members.get(token);
    if (!member) return { error: { code: 'bad_token', message: 'That seat is no longer available.' } };
    if (member.dropTimer) this.clock.clearTimeout(member.dropTimer);
    member.dropTimer = null;
    member.offlineAt = null;
    const previous = member.conn;
    member.conn = conn;
    member.away = false;
    this.idleSince = null;
    if (previous && previous !== conn) this.#send(previous, { t: 'closed', reason: 'replaced' });
    this.#send(conn, { t: 'joined', code: this.code, token, color: member.color, preferred: member.preferred, id: member.id, name: member.name });
    this.#armLeaveTimers();
    this.#schedule(); // before the snapshot, so it says how much time is left for whoever is being waited for
    if (this.state) this.#send(conn, this.#snapshotMessage('snapshot'));
    this.#broadcastRoom();
    return { token, replaced: previous && previous !== conn ? previous : null };
  }

  // The connection dropped. The person keeps their seat so they can come back.
  disconnect(token, conn) {
    const member = this.members.get(token);
    if (!member || member.conn !== conn) return;
    member.conn = null;
    member.offlineAt = this.clock.now();
    if (this.connectedCount() === 0) this.idleSince = this.clock.now();
    if (this.phase === 'lobby') {
      member.dropTimer = this.clock.setTimeout(() => this.#dropFromLobby(token), this.config.lobbyGraceMs);
    } else if (this.phase === 'playing' && this.config.disconnectLeaveMs != null) {
      // A lost or too weak connection that does not come back in time counts as leaving the game.
      member.dropTimer = this.clock.setTimeout(() => this.#dropFromGame(token), this.config.disconnectLeaveMs);
    }
    this.#broadcastRoom();
    this.#schedule();
  }

  // Offline for too long in a running game: the person has left the game completely. Their seat is removed (the computer does NOT
  // play it), everybody is told, and their saved seat stops working (they get "your seat is no longer available" if they
  // come back).
  #dropFromGame(token) {
    const member = this.members.get(token);
    if (!member || member.conn || this.phase !== 'playing') return;
    if (this.connectedCount() === 0) return; // everybody is offline (a problem on the way to the server, not theirs): the game just waits (see #armLeaveTimers)
    this.leave(token);
  }

  // Somebody is back, so the server is reachable again: everybody still offline gets a full leave time from now (their timers may
  // have run out while nobody at all was connected, which does not count against them).
  #armLeaveTimers() {
    if (this.phase !== 'playing' || this.config.disconnectLeaveMs == null) return;
    for (const other of this.members.values()) {
      if (other.conn) continue;
      if (other.dropTimer) this.clock.clearTimeout(other.dropTimer);
      other.dropTimer = this.clock.setTimeout(() => this.#dropFromGame(other.token), this.config.disconnectLeaveMs);
    }
  }

  #dropFromLobby(token) {
    const member = this.members.get(token);
    if (!member || member.conn || this.phase !== 'lobby') return;
    this.#removeMember(member);
    this.#broadcastRoom();
  }

  // Someone leaves (on purpose, or because they were offline too long). In the lobby their seat becomes free. In a running game
  // they are out completely: their tokens leave the board, they get no more turns, nobody plays their seat, and if only one
  // player is left that player wins. The other players carry on.
  leave(token) {
    const member = this.members.get(token);
    if (!member) return;
    const removeFromGame = this.phase === 'playing' && this.state;
    if (removeFromGame) this.leftNames.set(member.color, member.name);
    this.#removeMember(member);
    if (removeFromGame) this.#playerLeftGame(member.color);
    this.#broadcastRoom();
    this.#schedule();
  }

  // Takes a seat out of the running game and tells the clients, in the numbered order of the game events: a 'left' event, and
  // (if it was that player's turn and the game goes on) the 'turn' that passes play to the next player.
  #playerLeftGame(color) {
    const { state } = this;
    const wasCurrent = state.currentPlayer === color;
    if (!state.removePlayer(color)) return;
    this.seq += 1;
    const over = state.phase === PHASE.GAME_OVER;
    this.#broadcast({ t: 'left', seq: this.seq, player: color, over, winner: over ? state.winner : null, rankings: over ? [...state.rankings] : [] });
    this.#clearTimer();
    this.autoTurn = null;
    if (over) {
      this.phase = 'over';
      return;
    }
    if (wasCurrent) this.#endTurn(); // (#endTurn schedules what happens next)
  }

  #removeMember(member) {
    if (member.dropTimer) this.clock.clearTimeout(member.dropTimer);
    this.members.delete(member.token);
    if (member.host) {
      const next = [...this.members.values()].find((m) => m.conn) ?? [...this.members.values()][0];
      if (next) next.host = true;
    }
    if (this.connectedCount() === 0) this.idleSince = this.clock.now();
    this.#matchCheck();
  }

  // --- "Play online" matchmaking -----------------------------------------------------------------

  // Once every seat is taken the game starts after a short pause (long enough to see who joined); if someone
  // leaves in that pause, the start is called off.
  #matchCheck() {
    if (!this.matchmaking || this.phase !== 'lobby') return;
    const full = this.occupiedColors().length >= this.maxSeats;
    if (full && !this.#startTimer) {
      this.#startTimer = this.clock.setTimeout(() => {
        this.#startTimer = null;
        if (this.matchmaking && this.phase === 'lobby' && this.occupiedColors().length >= this.maxSeats) this.#beginGame();
      }, this.config.matchStartDelayMs);
    } else if (!full && this.#startTimer) {
      this.clock.clearTimeout(this.#startTimer);
      this.#startTimer = null;
    }
  }

  // "Play online": with 5 to 8 seconds of the wait left (config.matchBotsFromMs), computers start taking the empty seats one at a
  // time, a little apart, so the match fills up like people arriving rather than all at once at the end. People who arrive
  // meanwhile still get the seats that are free. The draws use thinkRng, so they never change the dice.
  #scheduleBotArrivals() {
    const range = this.config.matchBotsFromMs;
    if (!range) return;
    const [lo, hi] = range;
    const left = lo + this.thinkRng() * (hi - lo); // time left on the countdown when the first one arrives
    this.#botTimer = this.clock.setTimeout(() => this.#botArrives(), Math.max(0, this.config.matchWaitMs - left));
  }

  #botArrives() {
    this.#botTimer = null;
    if (!this.matchmaking || this.phase !== 'lobby' || this.members.size === 0) return;
    const color = this.#freeColor();
    if (!color || this.occupiedColors().length >= this.maxSeats) return;
    this.ais.add(color);
    this.#broadcastRoom();
    this.#matchCheck(); // the last seat taken: the game starts shortly, before the countdown ends
    const free = this.maxSeats - this.occupiedColors().length;
    if (free === 0) return;
    // The rest arrive spread over the time that is left (keeping half a second before the end), at slightly uneven gaps.
    const remaining = Math.max(0, this.deadlineAt - this.clock.now() - 500);
    const gap = (remaining / (free + 1)) * (0.7 + this.thinkRng() * 0.6);
    this.#botTimer = this.clock.setTimeout(() => this.#botArrives(), Math.max(300, gap));
  }

  // Nobody else came in time: computers take the empty seats and the game starts.
  #matchDeadline() {
    this.#matchTimer = null;
    if (!this.matchmaking || this.phase !== 'lobby' || this.members.size === 0) return;
    for (let color = this.#freeColor(); this.occupiedColors().length < this.maxSeats && color; color = this.#freeColor()) this.ais.add(color);
    this.#beginGame();
  }

  #clearMatchTimers() {
    if (this.#matchTimer) this.clock.clearTimeout(this.#matchTimer);
    if (this.#startTimer) this.clock.clearTimeout(this.#startTimer);
    if (this.#botTimer) this.clock.clearTimeout(this.#botTimer);
    this.#matchTimer = null;
    this.#startTimer = null;
    this.#botTimer = null;
  }

  // Stops all timers; call when the room is being thrown away.
  destroy() {
    this.#clearTimer();
    this.#clearMatchTimers();
    for (const m of this.members.values()) if (m.dropTimer) this.clock.clearTimeout(m.dropTimer);
  }

  // --- messages from people -------------------------------------------------------------------

  handle(token, msg) {
    const member = this.members.get(token);
    if (!member) return;
    // Nobody manages a matchmaking lobby: seats and the start are decided by the server.
    if (this.matchmaking && this.phase === 'lobby' && ['color', 'addAi', 'removeAi', 'start'].includes(msg.t)) {
      return this.#error(member.conn, 'bad_phase', 'That is not possible while looking for players.');
    }
    switch (msg.t) {
      case 'color': return this.#changeColor(member, msg.color);
      case 'addAi': return this.#addAi(member);
      case 'removeAi': return this.#removeAi(member, msg.color);
      case 'start': return this.#start(member);
      case 'rematch': return this.#rematch(member);
      case 'roll': return this.#humanRoll(member);
      case 'move': return this.#humanMove(member, msg.index);
      case 'react': return this.#react(member, msg.id);
      case 'sync':
        if (this.state) this.#send(member.conn, this.#snapshotMessage('snapshot'));
        else this.#send(member.conn, { t: 'room', room: this.info(member) });
        return;
      default:
        this.#error(member.conn, 'unknown', 'Unknown message.');
    }
  }

  #requireHost(member, phase) {
    if (!member.host) return this.#error(member.conn, 'not_host', 'Only the host can do that.'), false;
    if (this.phase !== phase) return this.#error(member.conn, 'bad_phase', 'That is not possible right now.'), false;
    return true;
  }

  #changeColor(member, color) {
    if (this.phase !== 'lobby') return this.#error(member.conn, 'bad_phase', 'Colours can only be changed in the lobby.');
    if (this.occupiedColors().includes(color) && color !== member.color) return this.#error(member.conn, 'color_taken', 'That colour is taken.');
    member.color = color;
    member.preferred = color; // choosing a colour in the lobby is choosing both the seat and the colour it is painted in
    this.#broadcastRoom();
  }

  #addAi(member) {
    if (!this.#requireHost(member, 'lobby')) return;
    const color = this.#freeColor();
    if (this.occupiedColors().length >= this.maxSeats || !color) return this.#error(member.conn, 'room_full', 'There is no free seat.');
    this.ais.add(color);
    this.#broadcastRoom();
  }

  #removeAi(member, color) {
    if (!this.#requireHost(member, 'lobby')) return;
    this.botNames.delete(color);
    if (!this.ais.delete(color)) return this.#error(member.conn, 'no_such_seat', 'That seat is not a computer.');
    this.#broadcastRoom();
  }

  #start(member) {
    if (!this.#requireHost(member, 'lobby')) return;
    const players = this.occupiedColors();
    if (players.length < 2) return this.#error(member.conn, 'not_enough_players', 'At least two players are needed.');
    this.#beginGame();
  }

  #beginGame() {
    this.#clearMatchTimers();
    this.leftNames.clear();
    this.state = new GameState({ players: this.occupiedColors(), rules: this.rules });
    this.phase = 'playing';
    this.seq = 0;
    for (const m of this.members.values()) m.away = false;
    this.#schedule(); // first, so the snapshot below says how long the first player has
    this.#broadcast(this.#snapshotMessage('started'));
    this.#broadcastRoom();
    this.#schedule();
  }

  #rematch(member) {
    if (!this.#requireHost(member, 'over')) return;
    this.#clearTimer();
    this.state = null;
    this.leftNames.clear();
    this.phase = 'lobby';
    // A rematch is an ordinary room: the host manages it (the matchmaking wait does not start again).
    this.matchmaking = false;
    this.deadlineAt = null;
    this.#broadcastRoom();
  }

  #humanRoll(member) {
    if (!this.#isPlaying(member)) return;
    if (member.color !== this.state.currentPlayer) return this.#error(member.conn, 'not_your_turn', 'It is not your turn.');
    if (this.state.phase !== PHASE.ROLL) return this.#error(member.conn, 'bad_phase', 'You cannot roll now.');
    member.away = false;
    this.#doRoll({});
  }

  #humanMove(member, index) {
    if (!this.#isPlaying(member)) return;
    if (member.color !== this.state.currentPlayer) return this.#error(member.conn, 'not_your_turn', 'It is not your turn.');
    if (this.state.phase !== PHASE.MOVE) return this.#error(member.conn, 'bad_phase', 'Roll the die first.');
    if (!this.state.legalMoves().includes(index)) return this.#error(member.conn, 'illegal_move', 'That token cannot move.');
    member.away = false;
    this.#doMove(index, {});
  }

  // A quick chat message, reaction or emoji. Only someone sitting in this room's game can send one, only for their own seat
  // (the seat, id and name come from the server's record of the sender, never from the message), only from the allowed list,
  // and no faster than the cooldown. Anything else is dropped without an answer, so a flood costs the room nothing.
  #react(member, id) {
    const reaction = reactionById(id);
    if (!reaction || !member.conn) return;
    if (this.phase !== 'playing' && this.phase !== 'over') return;
    const group = cooldownGroup(reaction.kind);
    const now = this.clock.now();
    member.sentAt ??= {};
    const last = member.sentAt[group];
    if (last !== undefined && now - last < COOLDOWN_MS[reaction.kind]) return;
    member.sentAt[group] = now;
    this.#broadcast({ t: 'reaction', seat: member.color, playerId: member.id, name: member.name, id: reaction.id });
  }

  #isPlaying(member) {
    if (this.phase === 'playing') return true;
    this.#error(member.conn, 'bad_phase', 'The game is not running.');
    return false;
  }

  // --- the game --------------------------------------------------------------------------------

  #doRoll(flags) {
    const { state } = this;
    const player = state.currentPlayer;
    const value = state.rollDice(this.rng);
    this.seq += 1;
    // utoMove tells clients the server will play the only legal move itself, so they should not prompt.
    const autoMove = this.#autoSingle() ? { autoMove: true } : {};
    this.#broadcast({ t: 'rolled', seq: this.seq, player, value, forfeited: state.forfeited, phase: state.phase, legal: state.legalMoves(), ...autoMove, ...this.#timeoutField(), ...flags });
    if (state.phase === PHASE.END) this.#endTurn();
    else this.#schedule();
  }

  #doMove(index, flags) {
    const { state } = this;
    const player = state.currentPlayer;
    const result = state.moveToken(index);
    this.seq += 1;
    // The server alone decides who finishes and in which position (`position` in the result, `rankings` in full); clients
    // replay the same rules and check that they got the same answer.
    this.#broadcast({ t: 'moved', seq: this.seq, player, index, ...result, winner: state.winner, rankings: [...state.rankings], ...flags });
    if (result.position && state.phase !== PHASE.GAME_OVER) this.#broadcastRoom(); // somebody finished: everybody's seat list now shows their status and position
    if (state.phase === PHASE.GAME_OVER) {
      this.phase = 'over';
      this.#clearTimer();
      this.#broadcastRoom();
    } else {
      this.#endTurn();
    }
  }

  #endTurn() {
    const extra = this.state.endTurn();
    this.autoTurn = null;
    this.seq += 1;
    this.#broadcast({ t: 'turn', seq: this.seq, player: this.state.currentPlayer, extra, ...this.#timeoutField() });
    this.#schedule();
  }

  // --- who acts next ---------------------------------------------------------------------------

  #clearTimer() {
    if (this.#timer) this.clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.waitKey = null;
    this.waitEndsAt = null;
  }

  // How long the person whose move it is has to act, or null when nobody is being waited for: a computer seat, a person who
  // is not connected, a move the server plays by itself, a finished roll with no move, or no game running.
  #humanWaitMs() {
    if (this.phase !== 'playing' || this.connectedCount() === 0) return null;
    const color = this.state.currentPlayer;
    const member = this.#memberOf(color);
    if (!member?.conn) return null;
    if (this.state.phase !== PHASE.ROLL && this.state.phase !== PHASE.MOVE) return null;
    if (this.#autoSingle()) return null;
    if (this.state.phase === PHASE.MOVE && this.autoTurn === color) return null; // the computer is finishing their turn
    return member.away ? this.config.awayTimeoutMs : this.config.turnTimeoutMs;
  }

  // The timeoutMs field of the roll and turn events: the time the person who now has the move is given, so every
  // screen can show the same countdown.
  #timeoutField() {
    const ms = this.#humanWaitMs();
    return ms === null ? {} : { timeoutMs: ms };
  }

  // Decides what happens next, and when:
  //   a computer seat           - the computer acts after a short pause;
  //   a person who disconnected - the computer acts, but only after a grace period (they may be back in a moment);
  //   a person's only legal move - played after a short pause;
  //   a person who is present   - the room waits for them, up to the turn timeout (15 s); the clients show that
  //                               countdown, and when it ends the computer rolls and plays its best move for them.
  //                               A countdown that is already running is left alone when something unrelated
  //                               calls this (so the countdown the screens show stays true).
  #schedule() {
    const waitMs = this.#humanWaitMs();
    const key = waitMs === null ? null : `${this.seq}:${this.state.currentPlayer}`;
    // The same wait is already counting down (something else changed, such as another person's connection): leave it alone,
    // so the countdown on every screen stays true.
    if (key !== null && key === this.waitKey && this.#timer) return;
    this.#clearTimer();
    if (this.phase !== 'playing') return;
    if (this.connectedCount() === 0) return; // nobody is watching: pause rather than play on alone
    const color = this.state.currentPlayer;
    const member = this.#memberOf(color);
    const rolling = this.state.phase === PHASE.ROLL;
    const pace = rolling ? this.config.aiThinkMs : this.config.aiPickMs;
    const after = (ms, fn) => {
      this.#timer = this.clock.setTimeout(fn, ms);
    };

    if (!member) return after(rolling ? this.#botThinkMs() : pace, () => this.#computerStep(null, true));
    if (!member.conn && this.config.disconnectLeaveMs != null) return; // nobody plays for them: the game waits until they are back or have left
    if (!member.conn) {
      const graceLeft = this.config.disconnectGraceMs - (this.clock.now() - (member.offlineAt ?? this.clock.now()));
      return after(rolling ? Math.max(pace, graceLeft) : pace, () => this.#computerStep(member, true));
    }
    if (this.#autoSingle()) {
      return after(this.config.aiPickMs, () => {
        this.#timer = null;
        if (this.phase === 'playing' && this.state.phase === PHASE.MOVE) this.#doMove(this.state.legalMoves()[0], { forced: true });
      });
    }
    if (!rolling && this.autoTurn === color) return after(pace, () => this.#computerStep(member, false)); // finish what was started
    this.waitKey = key;
    this.waitEndsAt = this.clock.now() + waitMs;
    return after(waitMs, () => this.#computerStep(member, false));
  }
  // How long a computer seat takes to roll: a random 2 to 5 seconds, so the bots do not all act at once and look like people.
  #botThinkMs() {
    const { aiThinkMinMs: lo, aiThinkMaxMs: hi, aiThinkMs } = this.config;
    if (lo == null || hi == null) return aiThinkMs;
    return Math.round(lo + this.thinkRng() * (hi - lo));
  }

  // True when it is a connected, present person's move and they have exactly one legal choice.
  #autoSingle() {
    if (!this.config.autoSingleMove || this.phase !== 'playing' || this.state.phase !== PHASE.MOVE) return false;
    const member = this.#memberOf(this.state.currentPlayer);
    return Boolean(member?.conn) && this.state.legalMoves().length === 1;
  }

  #computerStep(member, wasComputerSeat) {
    this.#timer = null;
    if (this.phase !== 'playing') return;
    // A person who let the timer run out is marked away, so their next turns are played quickly too.
    if (!wasComputerSeat && member) {
      member.away = true;
      this.autoTurn = member.color;
    }
    const flags = wasComputerSeat ? { ai: true } : { auto: true };
    if (this.state.phase === PHASE.ROLL) {
      this.#doRoll(flags);
    } else if (this.state.phase === PHASE.MOVE) {
      // A computer seat plays at the room's skill level; when a person ran out of time the computer plays its best move for them.
      this.#doMove(chooseMove(this.state, wasComputerSeat ? this.difficulty : 'hard', this.rng), flags);
    }
    if (!wasComputerSeat) this.#broadcastRoom();
  }
}
