import Phaser from 'phaser';
import { COLORS, PLAYERS } from '../config/constants.js';
import { makePalette } from '../config/palette.js';
import { perspectiveColors } from '../game/perspective.js';
import { estimateTextWidth, layout } from '../config/layout.js';
import { settingsStore } from '../config/settingsStore.js';
import { Button } from '../objects/Button.js';
import { addBackground } from '../ui/background.js';
import { PLAY_ONLINE_SIZE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../online/protocol.js';
import { onlineSession } from '../online/session.js';
import { Toast } from '../ui/Toast.js';
import { addText } from '../ui/SpriteText.js';
import { UI } from '../ui/theme.js';

// What to tell people when the server says no (the server's own wording is used for anything not listed).
const FRIENDLY = {
  no_such_room: 'No room with that code.',
  room_full: 'That room is full.',
  in_progress: 'That game has already started.',
  bad_token: 'You were away too long, so you left the game.',
  not_enough_players: 'At least two players are needed.',
  busy: 'The server is busy. Try again later.',
  replaced: 'You joined from another window.',
};

// Everything between the main menu and the game for online play: connecting, create / join, the code
// keypad, and the lobby where seats are taken and the host starts the game. One scene, several screens;
// each screen is rebuilt from the shared online session, so rotating the device (which rebuilds scenes) keeps
// the person where they were.
export class OnlineScene extends Phaser.Scene {
  constructor() {
    super('OnlineScene');
  }

  // `data.intent` says which splash button opened this scene: 'play' (search for a match at once) or 'friends'.
  create(data) {
    addBackground(this);
    this.intent = data?.intent ?? null;
    this.wantedColor = data?.color ?? null; // the colour chosen in the Play Online popup
    this.session = onlineSession;
    this.layer = [];
    this.screen = null;
    this.entry = '';
    this.busy = false;
    this.alive = true;
    this.toast = new Toast(this);
    this.keyHandler = null;

    const s = this.session;
    const offs = [
      s.on('joined', () => {
        this.busy = false;
        this.show('lobby');
      }),
      s.on('room', () => {
        if (this.screen === 'lobby') this.show('lobby');
      }),
      s.on('lobby', () => this.show('lobby')),
      s.on('started', () => this.scene.start('GameScene', { mode: 'online' })),
      s.on('status', ({ status }) => this.onStatus(status)),
      s.on('error', (error) => this.onError(error)),
    ];
    this.onEsc = () => this.back();
    this.input.keyboard?.on('keydown-ESC', this.onEsc);
    this.events.once('shutdown', () => {
      this.alive = false;
      offs.forEach((off) => off());
      this.input.keyboard?.off('keydown-ESC', this.onEsc);
      this.removeKeys();
    });

    if (s.game) this.scene.start('GameScene', { mode: 'online' });
    else if (s.client?.connected) this.landing();
    else this.startConnecting();
  }

  // --- navigation --------------------------------------------------------------------------------

  // Where to go once connected: back into the room you are in, straight to what the splash button asked for, or
  // (if this browser has a saved seat to offer, or nothing was asked) the choice screen.
  landing() {
    if (this.session.inRoom) return this.show('lobby');
    const intent = this.intent;
    this.intent = null;
    if (intent && !this.session.savedSeat()) {
      if (intent === 'friends') return this.show('friends');
      this.show('finding');
      return this.findMatch();
    }
    return this.show('home');
  }

  startConnecting() {
    this.show('connecting');
    this.session
      .connect()
      .then(() => {
        if (this.alive && this.screen === 'connecting') this.landing();
      })
      .catch((error) => {
        console.warn('Online connection failed:', error?.message ?? error);
        if (this.alive) this.show('failed');
      });
  }

  goMenu() {
    this.session.disconnect();
    this.scene.start('MenuScene');
  }

  back() {
    switch (this.screen) {
      case 'friends':
        return this.goMenu();
      case 'create':
      case 'join':
        return this.show('friends');
      case 'lobby':
        this.session.leave();
        return this.goMenu();
      default:
        return this.goMenu();
    }
  }

  onStatus(status) {
    if (status === 'reconnecting') this.toast.hold('Connection lost. Reconnecting...');
    else if (status === 'connected' && this.wasReconnecting) {
      this.toast.show('Reconnected');
      if (this.screen === 'connecting') this.show('home');
    } else if (status === 'failed' && this.screen !== 'connecting' && this.screen !== 'failed') {
      this.toast.clear();
      this.show('failed');
    }
    this.wasReconnecting = status === 'reconnecting';
  }

  onError({ code, message }) {
    this.busy = false;
    this.toast.show(FRIENDLY[code] ?? message ?? 'Something went wrong.');
    if (code === 'bad_token' || code === 'replaced' || this.screen === 'finding') this.show('home');
  }

  // --- building screens --------------------------------------------------------------------------

  own(object) {
    this.layer.push(object);
    return object;
  }

  clearLayer() {
    this.removeKeys();
    for (const item of this.layer) item.destroy();
    this.layer = [];
  }

  show(screen) {
    if (!this.alive) return;
    this.clearLayer();
    this.screen = screen;
    this[`build_${screen}`]();
  }

  header(info) {
    const o = layout.online;
    this.own(addText(this, layout.width / 2, o.titleY, 'Online Multiplayer', { fontSize: `${o.titleFont}px`, color: '#ffffff' }).setOrigin(0.5));
    if (info) {
      this.own(addText(this, layout.width / 2, o.infoY, info, { fontSize: `${o.infoFont}px`, color: UI.muted, align: 'center' }).setOrigin(0.5));
    }
  }

  // A centred stack of buttons under the header: [{ label, color, onClick, enabled }].
  stack(items) {
    const { stack } = layout.online;
    items.forEach((item, i) => {
      this.own(new Button(this, layout.width / 2, stack.ys[i], { label: item.label, color: item.color, width: stack.w, height: stack.h, fontSize: stack.font, onClick: item.onClick }).setEnabled(item.enabled !== false));
    });
  }

  build_connecting() {
    this.header('Connecting to the server...');
    this.stack([{ label: 'Cancel', color: UI.neutral, onClick: () => this.goMenu() }]);
  }

  build_failed() {
    this.header('Could not connect');
    this.stack([
      { label: 'Try again', color: UI.ok, onClick: () => this.startConnecting() },
      { label: 'Back', color: UI.neutral, onClick: () => this.goMenu() },
    ]);
    // Say where it tried, so a wrong or unreachable server address is obvious (the browser gives no other detail).
    let url;
    try {
      url = this.session.getUrl();
    } catch {
      url = '';
    }
    const lines = ['The game server did not answer at', url, 'Check that it is running'].filter(Boolean);
    const { stack } = layout.online;
    const font = Math.min(layout.online.infoFont * 0.85, ...lines.map((l) => (layout.width - 40) / estimateTextWidth(l.length, 1)));
    lines.forEach((line, i) => this.own(addText(this, layout.width / 2, stack.ys[1] + stack.h / 2 + 30 + font * 1.4 * (i + 0.5), line, { fontSize: `${font}px`, color: UI.muted, align: 'center' }).setOrigin(0.5)));
  }

  // Shown while the search request is on its way (before the server puts you in a match).
  build_finding() {
    this.header('Looking for players...');
    this.stack([{ label: 'Cancel', color: UI.neutral, onClick: () => this.goMenu() }]);
  }

  build_home() {
    this.header('Choose how to play');
    const saved = this.session.savedSeat();
    const items = [
      { label: 'Play online', color: COLORS.green, onClick: () => this.findMatch() },
      { label: 'With friends', color: COLORS.blue, onClick: () => this.show('friends') },
    ];
    if (saved) items.push({ label: `Rejoin room ${saved.code}`, color: UI.accent, onClick: () => this.rejoin() });
    items.push({ label: 'Back', color: UI.neutral, onClick: () => this.goMenu() });
    this.stack(items);
  }

  // "Play online": starts searching at once for a 4-player match with other people; computers fill the empty seats
  // after 20 seconds.
  findMatch() {
    if (this.busy) return;
    this.busy = true;
    // The colour from the popup; from the choice screen (saved seat) there is none, so the colour used last time.
    this.session.quick(PLAY_ONLINE_SIZE, this.wantedColor ?? settingsStore.load().humanColor);
  }

  build_friends() {
    this.header('Create a room or join one');
    this.stack([
      { label: 'Create a room', color: COLORS.green, onClick: () => this.show('create') },
      { label: 'Join with a code', color: COLORS.blue, onClick: () => this.openJoin() },
      { label: 'Back', color: UI.neutral, onClick: () => this.goMenu() },
    ]);
  }

  rejoin() {
    this.busy = true;
    if (!this.session.rejoin()) {
      this.busy = false;
      this.toast.show('Could not rejoin.');
    }
  }

  build_create() {
    this.header('How many friends?');
    const make = (friends) => () => {
      if (this.busy) return;
      this.busy = true;
      const settings = settingsStore.load();
      this.session.create({ seats: friends + 1, rules: settings.rules, difficulty: settings.difficulty });
    };
    this.stack([
      ...[1, 2, 3].map((n) => ({ label: n === 1 ? '1 friend' : `${n} friends`, color: UI.info, onClick: make(n) })),
      { label: 'Back', color: UI.neutral, onClick: () => this.show('friends') },
    ]);
  }

  // --- room code keypad --------------------------------------------------------------------------

  openJoin() {
    this.entry = '';
    this.show('join');
  }

  build_join() {
    const k = layout.online.keypad;
    this.header('Enter the room code');
    this.boxes = [];
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const r = k.boxRect(i);
      const bg = this.own(this.add.graphics());
      const text = this.own(addText(this, r.x, r.y, '', { fontSize: `${k.codeFont}px`, color: '#ffffff' }).setOrigin(0.5));
      this.boxes.push({ r, bg, text });
    }
    [...ROOM_CODE_ALPHABET].forEach((letter, i) => {
      const r = k.keyRect(i);
      this.own(new Button(this, r.x, r.y, { label: letter, color: UI.info, width: r.w, height: r.h, fontSize: k.keyFont, onClick: () => this.typeLetter(letter) }));
    });
    const bottom = (j, label, color, onClick) => {
      const r = k.bottomRect(j);
      return this.own(new Button(this, r.x, r.y, { label, color, width: r.w, height: r.h, fontSize: k.bottomFont, onClick }));
    };
    bottom(0, 'Back', UI.neutral, () => this.show('friends'));
    bottom(1, 'Delete', UI.neutral, () => this.deleteLetter());
    this.joinButton = bottom(2, 'Join', UI.ok, () => this.submitCode());
    this.refreshCode();

    // Desktop: type the letters, Backspace to delete, Enter to join.
    this.keyHandler = (event) => {
      const key = event.key?.toUpperCase();
      if (event.key === 'Backspace') this.deleteLetter();
      else if (event.key === 'Enter') this.submitCode();
      else if (key?.length === 1 && ROOM_CODE_ALPHABET.includes(key)) this.typeLetter(key);
    };
    this.input.keyboard?.on('keydown', this.keyHandler);
  }

  removeKeys() {
    if (this.keyHandler) this.input?.keyboard?.off('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  typeLetter(letter) {
    if (this.screen !== 'join' || this.entry.length >= ROOM_CODE_LENGTH) return;
    this.entry += letter;
    this.refreshCode();
  }

  deleteLetter() {
    if (this.screen !== 'join') return;
    this.entry = this.entry.slice(0, -1);
    this.refreshCode();
  }

  refreshCode() {
    this.boxes.forEach(({ r, bg, text }, i) => {
      text.setText(this.entry[i] ?? '');
      const active = i === this.entry.length;
      bg.clear()
        .fillStyle(UI.panel, 1)
        .fillRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 14)
        .lineStyle(active ? 4 : 2, active ? UI.accent : UI.border, 1)
        .strokeRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 14);
    });
    this.joinButton.setEnabled(this.entry.length === ROOM_CODE_LENGTH);
  }

  submitCode() {
    if (this.screen !== 'join' || this.entry.length !== ROOM_CODE_LENGTH || this.busy) return;
    this.busy = true;
    this.session.join(this.entry);
  }

  // --- lobby -------------------------------------------------------------------------------------

  build_lobby() {
    const { session } = this;
    const { room } = session;
    const lb = layout.online.lobby;
    if (!room) {
      this.header('Joining...');
      return;
    }
    if (room.matchmaking) return this.buildSearching(room);
    const host = session.isHost;
    this.header(host ? 'Share this code with friends' : 'Waiting for the host...');

    this.own(addText(this, lb.label.x, lb.label.y, 'Room code (tap to copy)', { fontSize: `${lb.label.font}px`, color: UI.muted }).setOrigin(0.5));
    const code = this.own(
      addText(this, lb.code.x, lb.code.y, room.code, { fontSize: `${lb.code.font}px`, color: '#ffd54f' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true }),
    );
    code.on('pointerdown', () => this.copyCode(room.code));

    const free = room.maxSeats - room.seats.length;
    const palette = this.roomPalette(room);
    PLAYERS.forEach((p, i) => this.seatRow(palette.entry(p.id), room.seats.find((s) => s.color === p.id), lb.seats[i], host, free));

    const [a0, a1, a2] = lb.actions;
    const action = (r, label, color, onClick, enabled = true) =>
      this.own(new Button(this, r.x, r.y, { label, color, width: r.w, height: r.h, fontSize: lb.actionFont, onClick }).setEnabled(enabled));
    if (host) {
      action(a0, 'Add computer', UI.info, () => session.send({ t: 'addAi' }), free > 0);
      action(a1, 'Start game', UI.ok, () => session.send({ t: 'start' }), room.seats.length >= 2);
    }
    action(a2, 'Leave', UI.danger, () => this.back());
  }

  // "Play online": waiting to be matched. Shows who has been found and a countdown; when it reaches zero the
  // server fills the empty seats with computers and starts the game.
  buildSearching(room) {
    const lb = layout.online.lobby;
    const full = room.seats.length >= room.maxSeats;
    this.header(full ? 'Match found!' : 'Looking for players...');
    if (full) this.own(addText(this, lb.label.x, lb.label.y, 'Starting the game', { fontSize: `${lb.label.font}px`, color: UI.muted }).setOrigin(0.5));

    const counter = this.own(
      addText(this, lb.code.x, lb.code.y, '', { fontSize: `${lb.code.font}px`, color: '#ffd54f' }).setOrigin(0.5),
    );
    const endsAt = Date.now() + (room.matchMsLeft ?? 0);
    const tick = () => counter.setText(full ? '...' : `${Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))}`);
    tick();
    const timer = this.time.addEvent({ delay: 250, loop: true, callback: tick });
    this.own({ destroy: () => timer.remove(false) });

    const palette = this.roomPalette(room);
    for (let i = 0; i < room.maxSeats; i++) this.searchRow(lb.seats[i], room.seats[i], palette);
    this.own(new Button(this, lb.actions[2].x, lb.actions[2].y, { label: 'Cancel', color: UI.danger, width: lb.actions[2].w, height: lb.actions[2].h, fontSize: lb.actionFont, onClick: () => this.back() }));
  }

  // How this screen paints the seats of a room: your own seat in the colour you asked for, the others in different colours
  // (the same map the game uses, see game/perspective.js). Seats nobody has taken keep their own colour.
  roomPalette(room) {
    const { session } = this;
    const taken = room.seats.map((s) => s.color);
    return makePalette(session.color ? perspectiveColors({ seat: session.color, preferred: session.preferred, seats: taken }) : {});
  }

  // One slot of the matchmaking screen: a person or computer that is in, or "Searching..." for an empty seat.
  searchRow(r, seat, palette) {
    const player = seat ? palette.entry(seat.color) : null;
    const mine = seat?.color === this.session.color;
    const status = !seat ? '' : mine ? 'You' : 'Player found'; // computers that fill a public match arrive like people
    const bg = this.own(this.add.graphics());
    bg.fillStyle(seat ? UI.panelLight : UI.panel, 1).fillRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12);
    bg.lineStyle(mine ? 4 : 2, mine ? player.color : UI.border, 1).strokeRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12);
    this.own(this.add.circle(r.x - r.w / 2 + 28, r.y, Math.min(r.h * 0.3, 18), player?.color ?? UI.border).setStrokeStyle(2, 0xffffff).setAlpha(seat ? 1 : 0.45));
    this.rowText(r, seat ? seat.name : 'Searching...', status, Boolean(seat));
  }

  // The two lines of a lobby row: a name (or a colour, for a free seat) and, smaller under it, what that seat is.
  rowText(r, title, subtitle, taken) {
    const font = layout.online.lobby.seatFont;
    const small = Math.max(font * 0.72, 10);
    const x = r.x - r.w / 2 + 56;
    const color = taken ? '#ffffff' : UI.muted;
    this.own(addText(this, x, subtitle ? r.y - font * 0.45 : r.y, title, { fontSize: `${font}px`, color }).setOrigin(0, 0.5));
    if (subtitle) this.own(addText(this, x, r.y + font * 0.62, subtitle, { fontSize: `${small}px`, color: UI.muted }).setOrigin(0, 0.5));
  }

  // One of the four colour rows: who sits there, and what tapping it does.
  seatRow(player, seat, r, host) {
    const { session } = this;
    const mine = player.id === session.color;
    let status = 'Empty (tap to sit)';
    let tap = () => session.send({ t: 'color', color: player.id });
    if (seat?.kind === 'ai') {
      status = host ? 'Computer - tap to remove' : 'Computer';
      tap = host ? () => session.send({ t: 'removeAi', color: player.id }) : null;
    } else if (seat) {
      status = `${mine ? 'You' : 'Player'}${seat.host ? ' - host' : ''}${seat.connected ? '' : ' - offline'}`;
      tap = null;
    }

    const bg = this.own(this.add.graphics());
    bg.fillStyle(seat ? UI.panelLight : UI.panel, 1).fillRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12);
    bg.lineStyle(mine ? 4 : 2, mine ? player.color : UI.border, 1).strokeRoundedRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 12);
    this.own(this.add.circle(r.x - r.w / 2 + 28, r.y, Math.min(r.h * 0.3, 18), player.color).setStrokeStyle(2, 0xffffff).setAlpha(seat ? 1 : 0.45));
    this.rowText(r, seat ? seat.name : player.label, status, Boolean(seat));
    if (tap) {
      const hit = this.own(this.add.rectangle(r.x, r.y, r.w, r.h, 0x000000, 0).setInteractive({ useHandCursor: true }));
      hit.on('pointerdown', tap);
    }
  }

  copyCode(code) {
    const done = () => this.toast.show('Room code copied');
    try {
      const copied = navigator.clipboard?.writeText(code);
      if (copied) copied.then(done, () => this.toast.show(`Room code: ${code}`));
      else this.toast.show(`Room code: ${code}`);
    } catch {
      this.toast.show(`Room code: ${code}`);
    }
  }
}
