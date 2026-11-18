import Phaser from 'phaser';
import { drawBoard } from '../board/drawBoard.js';
import { drawSafeCells } from '../board/drawSafeCells.js';
import { setBoardRotation, turnsToBottomLeft } from '../board/geometry.js';
import { AVATAR_KEYS } from '../config/assets.js';
import { makePalette } from '../config/palette.js';
import { profileStore } from '../config/profileStore.js';
import { settingsStore } from '../config/settingsStore.js';
import { assignAvatars, newAvatarSeed } from '../game/avatars.js';
import { botName } from '../game/botNames.js';
import { chooseMove } from '../game/ai.js';
import { GameState, PHASE } from '../game/GameState.js';
import { perspectiveColors } from '../game/perspective.js';
import { IN_YARD } from '../game/path.js';
import { computersFor, seatsFor } from '../game/settings.js';
import { TurnController } from '../game/TurnController.js';
import { COOLDOWN_MS, cooldownGroup, reactionById } from '../online/reactions.js';
import { onlineSession } from '../online/session.js';
import { Animator } from '../systems/Animator.js';
import { addBackground } from '../ui/background.js';
import { Modal } from '../ui/Modal.js';
import { ReactionPanel } from '../ui/ReactionPanel.js';
import { Toast } from '../ui/Toast.js';
import { UI } from '../ui/theme.js';
import { PhaserGameView } from '../views/PhaserGameView.js';

const BOT_THINK_MIN_MS = 2000;
const BOT_THINK_MAX_MS = 5000;

// Thin wiring scene: builds the board, creates the game state and view, and connects player input to whatever
// runs the game. Locally (and against the computer) that is a TurnController; online it is the OnlineGame
// that keeps in step with the server. All game flow lives in those classes.
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    // The resume field carries a game in progress across a layout change; it must not survive a Restart.
    const { resume, ...rest } = data ?? {};
    this.sceneData = rest;
    this.resumeState = resume ?? null;
    this.modal = null;
  }

  // Data that rebuilds this scene with the same game in progress (used when the screen layout changes).
  // An online game lives in the online session, so it needs no state passed along.
  getRestartData() {
    return this.sceneData.mode === 'online' ? { mode: 'online' } : { ...this.sceneData, resume: this.state };
  }

  create() {
    addBackground(this);
    if (this.sceneData.mode === 'online') this.createOnline();
    else this.createLocal();
  }

  // --- local multiplayer and Player vs Computer ---------------------------------------------------

  createLocal() {
    const settings = this.sceneData.settings ?? settingsStore.load();
    this.sceneData = { ...this.sceneData, settings };
    const mode = this.sceneData.mode ?? 'local';
    // The setup popup passes the seating (colours in turn order); without it, use the last saved choice.
    const seats = this.sceneData.players ?? (mode === 'computer' ? seatsFor(settings.vsPlayers, settings.humanColor) : settings.localColors);
    this.state = this.resumeState ?? new GameState({ players: seats, rules: settings.rules });
    const players = this.state.players;
    const computers = computersFor(mode, players);
    // Random avatars for this game. The seed is kept in the scene data, so rotating the phone keeps the same ones; Restart drops it.
    const avatarSeed = this.sceneData.avatarSeed ?? newAvatarSeed();
    this.sceneData = { ...this.sceneData, avatarSeed };

    // The board is turned so that the first (main) player's colour, and so their die, is in the bottom left corner:
    // against the computer and in Local Multiplayer.
    setBoardRotation(mode === 'computer' || mode === 'local' ? turnsToBottomLeft(players[0]) : 0);
    drawBoard(this, { activePlayers: players });
    drawSafeCells(this);

    const animator = new Animator(this);
    const view = new PhaserGameView(this, animator, this.state, {
      onRoll: () => this.controller.requestRoll(),
      onPick: (index) => this.controller.requestMove(index),
      onRestartRequest: () => this.confirmLeave('Restart game?', 'Restart', () => this.restart()),
      onMenuRequest: () => this.confirmLeave('Leave game?', 'Leave', () => this.toMenu()),
      onPlayAgain: () => this.restart(),
      onExit: () => this.toMenu(),
      computers,
      vsComputer: mode === 'computer',
      // Against the computer your own name is shown under your avatar, and ordinary-looking usernames under the others'
      // (the same ones all game: they come from the avatar seed, which survives a rotated screen).
      ...(mode === 'computer' ? { you: players[0], names: this.botNamesFor(players, avatarSeed) } : {}),
      avatars: assignAvatars(players, avatarSeed, AVATAR_KEYS),
    });
    this.controller = new TurnController(this.state, view, {
      computers,
      chooseMove: (state) => chooseMove(state, settings.difficulty),
      thinkMs: () => BOT_THINK_MIN_MS + Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS), // bots wait 2 to 5 seconds before rolling
      autoSingleMove: true, // only one legal move: play it for the person
    });
    this.events.once('shutdown', () => this.controller.dispose());
    this.input.keyboard?.on('keydown-SPACE', () => this.controller.requestRoll());
    this.controller.start();

    // Development only: lets browser tests inspect and set up the game. Removed from production builds.
    if (import.meta.env.DEV) window.__ludo = { scene: this, state: this.state, controller: this.controller, view };
  }

  // { seat: name }: this person's own name for the first seat, a different made-up username for each computer.
  botNamesFor(players, seed) {
    const names = { [players[0]]: profileStore.name() };
    for (const seat of players.slice(1)) names[seat] = botName(`${seed}:${seat}`, Object.values(names));
    return names;
  }

  // --- online ------------------------------------------------------------------------------------

  createOnline() {
    const session = onlineSession;
    const game = session.game;
    if (!game) {
      this.scene.start('MenuScene'); // nothing to play (for example after the session ended)
      return;
    }
    this.state = game.state;
    const players = this.state.players;

    setBoardRotation(turnsToBottomLeft(session.color)); // your colour in the bottom left corner
    // Everybody sees their own seat in the colour they asked for, and the others in different colours (the game itself only knows seats).
    this.palette = makePalette(perspectiveColors({ seat: session.color, preferred: session.preferred, seats: players }));
    drawBoard(this, { activePlayers: players, palette: this.palette });
    drawSafeCells(this);

    const animator = new Animator(this);
    this.toast = new Toast(this);
    const view = new PhaserGameView(this, animator, this.state, {
      onRoll: () => game.requestRoll(),
      onPick: (index) => game.requestMove(index),
      onRestartRequest: () => {},
      onMenuRequest: () => this.confirmLeave('Leave game?', 'Leave', () => this.leaveOnline(), 'You will leave the match for good.'),
      onPlayAgain: () => {},
      onExit: () => this.leaveOnline(),
      computers: this.aiSeats(session.room),
      you: session.color,
      palette: this.palette,
      names: this.namesOf(session.room),
      pauseOnFinish: false, // the others are still playing, so the game cannot wait for this screen
      onChat: () => this.toggleReactions(),
      avatars: assignAvatars(players, session.code, AVATAR_KEYS), // the room code is the seed: the same avatars on every screen
      restartEnabled: false,
      endButtons: () => [
        { label: session.isHost ? 'Rematch' : 'Waiting for host', color: UI.ok, enabled: session.isHost, onClick: () => session.send({ t: 'rematch' }) },
        { label: 'Home', color: UI.neutral, onClick: () => this.leaveOnline() },
      ],
    });
    this.view = view;
    this.controller = game;
    game.attach(view);
    this.input.keyboard?.on('keydown-SPACE', () => game.requestRoll());

    // Keep the screen in step with the room: who is a computer now, who dropped, a rematch, the connection.
    let seats = new Map((session.room?.seats ?? []).map((s) => [s.color, s]));
    const offs = [
      session.on('room', ({ room }) => {
        if (room.phase === 'lobby') {
          this.scene.start('OnlineScene');
          return;
        }
        view.setSeats({ computers: this.aiSeats(room), names: this.namesOf(room) });
        this.announceSeatChanges(seats, room);
        seats = new Map(room.seats.map((s) => [s.color, s]));
      }),
      session.on('status', ({ status }) => this.onConnection(status)),
      // The server no longer has this seat (we were offline too long and the computer took over): the game is over for us.
      session.on('error', ({ code, message }) => {
        if (code === 'bad_token' || code === 'no_such_room') this.showLeft('You were offline too long, so you left the game.');
        else this.toast.show(message ?? 'Something went wrong.');
      }),
      session.on('notice', ({ text }) => this.toast.show(text)),
      // Reactions come from the server only (our own too), so every screen shows the same thing for the same player.
      session.on('reaction', ({ seat, name, id }) => {
        const reaction = reactionById(id);
        if (reaction) view.showReaction(seat, reaction, name);
      }),
    ];
    this.events.once('shutdown', () => {
      offs.forEach((off) => off());
      game.detach();
    });

    if (import.meta.env.DEV) window.__ludo = { scene: this, state: this.state, controller: game, view, session };
  }

  // Each seat's name, as the server knows it. A name belongs to a seat (a player id), never to a colour, so every screen
  // shows the same name for the same seat even when it paints that seat in a different colour.
  namesOf(room) {
    return Object.fromEntries((room?.seats ?? []).map((s) => [s.color, s.name]));
  }

  // The Chat button: opens the quick chat / reactions / emojis panel, or closes it if it is open.
  toggleReactions() {
    if (this.reactionPanel) {
      this.reactionPanel.close();
      return;
    }
    if (this.modal) return;
    this.reactionPanel = new ReactionPanel(this, {
      cooldownLeft: (kind) => this.cooldownLeft(kind),
      onPick: (reaction) => this.sendReaction(reaction),
      onClose: () => {
        this.reactionPanel = null;
      },
    });
  }

  // The same limits the server enforces (reactions.js), so a press that would be dropped is not sent at all.
  cooldownLeft(kind) {
    const last = this.reactionSentAt?.[cooldownGroup(kind)];
    return last === undefined ? 0 : Math.max(0, COOLDOWN_MS[kind] - (Date.now() - last));
  }

  sendReaction(reaction) {
    const wait = this.cooldownLeft(reaction.kind);
    if (wait > 0) {
      this.toast.show(`Wait ${Math.ceil(wait / 1000)} s before the next one`);
      return;
    }
    if (!onlineSession.react(reaction.id)) return;
    this.reactionSentAt = { ...this.reactionSentAt, [cooldownGroup(reaction.kind)]: Date.now() };
  }

  aiSeats(room) {
    return (room?.seats ?? []).filter((s) => s.kind === 'ai').map((s) => s.color);
  }

  // Tells the player when someone else's seat changes hands or drops.
  announceSeatChanges(before, room) {
    for (const seat of room.seats) {
      const old = before.get(seat.color);
      if (!old || seat.color === onlineSession.color) continue;
      if (old.kind === 'human' && seat.kind === 'left') this.toast.show(`${old.name} left the game.`);
      else if (old.kind === 'human' && seat.kind === 'ai') this.toast.show(`${old.name} left: the computer takes over.`);
      else if (old.connected && !seat.connected) this.toast.show(`${seat.name} lost connection. They leave the game if it does not come back.`);
      else if (!old.connected && seat.connected) this.toast.show(`${seat.name} is back.`);
    }
  }

  onConnection(status) {
    if (status === 'reconnecting') this.toast.hold('Connection lost. Reconnecting...');
    else if (status === 'connected' && this.wasReconnecting) this.toast.show('Reconnected.');
    else if (status === 'failed') this.showLeft('Could not reconnect to the game, so you left it.');
    this.wasReconnecting = status === 'reconnecting';
  }

  // "You left the game": after losing the connection for good. One button, back to the menu; nothing else on screen can be used.
  showLeft(message) {
    if (this.leftModal) return;
    this.toast.clear();
    this.reactionPanel?.close();
    this.modal?.close();
    this.modal = null;
    this.leftModal = new Modal(this, {
      title: 'You left the game',
      message,
      buttons: [{ label: 'Menu', color: UI.ok, onClick: () => this.leaveOnline() }],
    });
  }

  leaveOnline() {
    onlineSession.leave();
    onlineSession.disconnect();
    this.scene.start('MenuScene');
  }

  // --- leaving ------------------------------------------------------------------------------------

  restart() {
    const { avatarSeed: _oldSeed, ...rest } = this.sceneData; // a new game gets new random avatars
    this.scene.restart(rest);
  }

  toMenu() {
    this.scene.start('MenuScene');
  }

  // Asks before throwing away a game in progress; acts immediately if nothing would be lost.
  confirmLeave(title, confirmLabel, action, message = 'The current game will be lost.') {
    if (this.modal) return;
    const online = this.sceneData.mode === 'online';
    const inProgress = online || this.state.players.some((id) => this.state.tokens[id].some((p) => p !== IN_YARD));
    if (!inProgress || this.state.phase === PHASE.GAME_OVER) {
      action();
      return;
    }
    const close = () => {
      this.modal?.close();
      this.modal = null;
    };
    this.modal = new Modal(this, {
      title,
      message,
      buttons: [
        { label: 'Keep playing', color: UI.neutral, onClick: close },
        { label: confirmLabel, color: UI.danger, onClick: () => { close(); action(); } },
      ],
      onDismiss: close,
    });
  }
}
