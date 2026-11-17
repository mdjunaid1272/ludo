import { profileStore } from '../config/profileStore.js';
import { OnlineClient } from './OnlineClient.js';
import { OnlineGame } from './OnlineGame.js';
import { isRoomCode, isToken, normalizeCode } from './protocol.js';

const SESSION_KEY = 'ludo.online.session.v1';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // a saved seat is forgotten after 12 hours
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000]; // about a minute in all

// Remembers which room and seat this browser had, so the person can come back after a reload or a long
// disconnect. Storage can be missing or blocked; everything is guarded.
export function createSessionStore(getStorage = () => globalThis.localStorage, now = () => Date.now()) {
  return {
    load() {
      try {
        const saved = JSON.parse(getStorage()?.getItem(SESSION_KEY) ?? 'null');
        if (!saved || !isRoomCode(saved.code) || !isToken(saved.token)) return null;
        if (typeof saved.at !== 'number' || now() - saved.at > SESSION_MAX_AGE_MS) return null;
        return { code: saved.code, token: saved.token };
      } catch {
        return null;
      }
    },
    save(code, token) {
      try {
        getStorage()?.setItem(SESSION_KEY, JSON.stringify({ code, token, at: now() }));
      } catch {
        // not remembered; the game still works
      }
    },
    clear() {
      try {
        getStorage()?.removeItem(SESSION_KEY);
      } catch {
        // nothing to clear
      }
    },
  };
}

// One online connection and the room it is in, shared by the screens (menu, lobby, game). It owns the
// socket, the reconnection loop, and the live OnlineGame. Screens listen for events:
//   status  { status }            'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
//   joined  { code, color, preferred, id, name }       you are in a room
//   room    { room }              the lobby/seat information changed
//   lobby   {}                    the room went back to its lobby (a rematch)
//   started { game }              a game is running; `game` is the OnlineGame
//   error   { code, message }     the server refused something
//   left    {}                    you left, or the seat is gone
//   notice  { text }              something to tell the person (e.g. the computer played their turn)
//   reaction { seat, playerId, name, id }  somebody in the room sent a quick chat message, reaction or emoji
export class OnlineSession {
  #listeners = new Map();
  #reconnectTimer = null;

  constructor({ createClient = () => new OnlineClient(), store = createSessionStore(), timers = globalThis, getUrl, normalizeCodeFn = normalizeCode, getName = () => profileStore.name() } = {}) {
    this.getName = getName; // this person's chosen name, sent when creating or joining a room (it is a label, not an identity)
    this.createClient = createClient;
    this.store = store;
    this.timers = timers;
    this.getUrl = getUrl;
    this.normalizeCode = normalizeCodeFn;
    this.client = null;
    this.status = 'idle';
    this.room = null;
    this.code = null;
    this.token = null;
    this.color = null; // this person's SEAT (where they play on the board)
    this.id = null; // this person's public player id, given by the server
    this.preferred = null; // the colour they asked for: what their own screen paints their seat in (see game/perspective.js)
    this.game = null;
    this.reconnecting = false;
    this.wantsConnection = false;
    this.lastError = null; // why the last attempt to connect failed (shown on the "Could not connect" screen)
    this.heard = 0; // counts messages received, to tell whether the server is still answering
  }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
    return () => this.#listeners.get(event)?.delete(fn);
  }

  #emit(event, payload = {}) {
    for (const fn of [...(this.#listeners.get(event) ?? [])]) fn(payload);
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.#emit('status', { status });
  }

  get inRoom() {
    return this.code !== null && this.token !== null;
  }

  // True if this person is the host of the room (they start games and manage computer seats).
  get isHost() {
    return Boolean(this.room?.seats.some((s) => s.color === this.color && s.host));
  }

  // Reads the saved seat, if there is one.
  savedSeat() {
    return this.store.load();
  }

  // --- connecting --------------------------------------------------------------------------------

  // Opens the connection. Resolves when connected; rejects (and sets status "failed") if it cannot.
  async connect() {
    if (this.client?.connected) return;
    this.wantsConnection = true;
    this.#setStatus('connecting');
    this.client?.close();
    this.client = this.createClient();
    this.client.onMessage = (m) => this.#onMessage(m);
    this.client.onClose = () => this.#onClosed();
    try {
      await this.client.connect(this.getUrl());
      this.lastError = null;
    } catch (error) {
      this.lastError = error?.message ?? String(error);
      this.#setStatus('failed');
      throw error;
    }
    this.#setStatus('connected');
  }

  // --- actions -----------------------------------------------------------------------------------

  send(message) {
    return Boolean(this.client?.send(message));
  }

  // The name to send along when creating or joining a room (nothing when there is none).
  #nameField() {
    const name = this.getName();
    return name ? { name } : {};
  }

  create(options) {
    return this.send({ t: 'create', ...options, ...this.#nameField() });
  }

  // "Play online": a public match for 2 or 4 players.
  quick(size, color = null) {
    return this.send({ t: 'quick', size, ...(color ? { color } : {}), ...this.#nameField() });
  }

  join(code) {
    return this.send({ t: 'join', code: this.normalizeCode(code), ...this.#nameField() });
  }

  // Takes the saved seat back (after a reload, or a long disconnect).
  rejoin() {
    const saved = this.store.load();
    if (!saved) return false;
    return this.send({ t: 'rejoin', code: saved.code, token: saved.token });
  }

  // Sends a quick chat message, reaction or emoji (an id from reactions.js). The server checks it and shows it to everybody.
  react(id) {
    return this.send({ t: 'react', id });
  }

  // Leaves the room on purpose.
  leave() {
    this.send({ t: 'leave' });
    this.#forget();
    this.#emit('left');
  }

  // Closes everything (back to the main menu).
  disconnect() {
    this.wantsConnection = false;
    this.#cancelReconnect();
    this.client?.close();
    this.client = null;
    this.#forget();
    this.#setStatus('idle');
  }

  #forget() {
    this.game?.dispose();
    this.game = null;
    this.room = null;
    this.code = null;
    this.token = null;
    this.color = null;
    this.preferred = null;
    this.id = null;
    this.store.clear();
  }

  // --- messages ----------------------------------------------------------------------------------

  #onMessage(m) {
    this.heard += 1;
    switch (m.t) {
      case 'joined':
        this.code = m.code;
        this.token = m.token;
        this.color = m.color;
        this.preferred = m.preferred ?? m.color;
        this.id = m.id ?? null;
        this.store.save(m.code, m.token);
        this.#emit('joined', { code: m.code, color: m.color });
        break;
      case 'room':
        this.room = m.room;
        if (m.room.you) this.color = m.room.you; // the lobby can move this person to another seat
        if (m.room.youPreferred) this.preferred = m.room.youPreferred;
        this.#emit('room', { room: m.room });
        if (m.room.phase === 'lobby' && this.game) {
          this.game.dispose();
          this.game = null;
          this.#emit('lobby');
        }
        break;
      case 'started':
        this.#startGame(m);
        break;
      case 'snapshot':
        if (this.game) this.game.handle(m);
        else this.#startGame(m); // came back into a game already in progress
        break;
      case 'rolled':
      case 'moved':
      case 'left':
      case 'turn':
        this.game?.handle(m);
        break;
      case 'reaction':
        this.#emit('reaction', { seat: m.seat, playerId: m.playerId, name: m.name, id: m.id });
        break;
      case 'pong':
        this.game?.checkSeq(m.seq);
        break;
      case 'closed':
        // This seat was taken over by another connection of ours (another tab). Stop reconnecting.
        this.wantsConnection = false;
        this.#emit('error', { code: 'replaced', message: 'You joined this game from another window.' });
        break;
      case 'error':
        this.game?.rejected();
        if (['bad_token', 'no_such_room'].includes(m.code) && this.reconnecting) this.#giveUp();
        if (m.code === 'bad_token' || (m.code === 'no_such_room' && !this.inRoom)) this.store.clear();
        this.#emit('error', { code: m.code, message: m.message });
        break;
      default:
    }
  }

  #startGame(m) {
    this.game?.dispose();
    this.game = new OnlineGame({
      snapshot: m.snapshot,
      seq: m.seq,
      timeoutMs: m.timeoutMs,
      myColor: this.color,
      send: (msg) => this.send(msg),
      onFatal: (error) => this.#emit('error', { code: 'bad_state', message: error.message }),
      notify: (text) => this.#emit('notice', { text }),
    });
    this.#emit('started', { game: this.game });
  }

  // The browser says the network went away (Wi-Fi switched off): treat the connection as lost at once, so the screen says
  // "Connection lost" and starts reconnecting, instead of looking frozen until the socket times out.
  connectionLost() {
    if (this.wantsConnection && this.client?.connected) this.client.drop();
  }

  // Call when the page comes back to the foreground or the network returns. A phone that slept often has a dead
  // connection that it does not know about yet: ping the server and, if nothing comes back soon, reconnect
  // right away instead of waiting for the operating system to notice.
  refreshConnection(waitMs = 3000) {
    if (!this.wantsConnection || !this.client) return;
    if (!this.client.connected) {
      if (!this.reconnecting) this.#onClosed();
      return;
    }
    const heardBefore = this.heard;
    this.send({ t: 'ping' });
    this.timers.setTimeout(() => {
      if (this.heard === heardBefore && this.client?.connected) this.client.drop();
    }, waitMs);
  }

  // --- reconnecting ------------------------------------------------------------------------------

  #onClosed() {
    if (!this.wantsConnection) {
      this.#setStatus('idle'); // closed and we are not reconnecting: do not keep claiming to be connected
      return;
    }
    this.#setStatus('reconnecting');
    this.#reconnectLoop();
  }

  async #reconnectLoop() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    for (const delay of RECONNECT_DELAYS_MS) {
      await new Promise((resolve) => {
        this.#reconnectTimer = this.timers.setTimeout(resolve, delay);
      });
      this.#reconnectTimer = null;
      if (!this.wantsConnection) break;
      try {
        this.client?.close();
        this.client = this.createClient();
        this.client.onMessage = (m) => this.#onMessage(m);
        this.client.onClose = () => this.#onClosed();
        await this.client.connect(this.getUrl());
      } catch {
        continue; // try again after the next delay
      }
      this.#setStatus('connected');
      this.reconnecting = false;
      if (this.inRoom) this.send({ t: 'rejoin', code: this.code, token: this.token });
      return;
    }
    if (this.reconnecting) this.#giveUp();
  }

  #giveUp() {
    this.reconnecting = false;
    this.#cancelReconnect();
    this.wantsConnection = false;
    this.#setStatus('failed');
  }

  #cancelReconnect() {
    if (this.#reconnectTimer !== null) this.timers.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.reconnecting = false;
  }
}
