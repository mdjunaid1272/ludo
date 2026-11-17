import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/online/protocol.js';
import { Room, realClock } from './Room.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxRooms: 500,
  emptyRoomMs: 10 * 60_000, // a room nobody is connected to is thrown away after this long
  sweepMs: 60_000,
});

export const randomCode = () => Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');

// Owns all the rooms and routes each connection's messages to the right one. A "session" is one connection's
// place in the system: { conn, room, token }. Like Room, it has no sockets in it (conn only needs send()).
export class RoomManager {
  #sweeper = null;

  constructor({ clock = realClock, limits = {}, roomOptions = {}, makeCode = randomCode } = {}) {
    this.clock = clock;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.roomOptions = roomOptions;
    this.makeCode = makeCode;
    this.rooms = new Map();
  }

  newSession(conn) {
    return { conn, room: null, token: null };
  }

  #error(session, code, message) {
    session.conn.send({ t: 'error', code, message });
  }

  // Handles one validated message from a connection.
  route(session, msg) {
    switch (msg.t) {
      case 'ping':
        // The pong carries the room's latest event number, so a client can notice it has missed events.
        session.conn.send({ t: 'pong', seq: session.room?.seq ?? null });
        return;
      case 'create': return this.#create(session, msg);
      case 'quick': return this.#quick(session, msg);
      case 'join': return this.#join(session, msg.code, msg.name);
      case 'rejoin': return this.#rejoin(session, msg.code, msg.token);
      case 'leave': return this.#leave(session);
      default:
        if (!session.room) return this.#error(session, 'no_room', 'You are not in a room.');
        session.room.handle(session.token, msg);
    }
  }

  #create(session, msg) {
    this.#leave(session);
    const room = this.#newRoom(session, { seats: msg.seats, rules: msg.rules, difficulty: msg.difficulty });
    if (room) this.#enter(session, room, null, msg.name);
  }

  // "Play online": sits the person in an open public room for that many players, or opens one. The room starts by
  // itself when it fills up, or after a short wait with computers in the empty seats (see Room).
  #quick(session, msg) {
    this.#leave(session);
    // A room where the wanted colour is free is best; otherwise any open room (the person gets another colour: keeping
    // people together matters more than a colour, or two people wanting the same one would never meet).
    const open = [...this.rooms.values()].filter((r) => r.isOpenForMatch(msg.size));
    const room = open.find((r) => msg.color && r.colorFree(msg.color)) ?? open[0] ?? this.#newRoom(session, { seats: msg.size, matchmaking: true });
    if (room) this.#enter(session, room, msg.color, msg.name);
  }

  // Creates a room under a fresh code, or tells the person why it cannot (and returns null).
  #newRoom(session, options) {
    if (this.rooms.size >= this.limits.maxRooms) return this.#error(session, 'busy', 'The server is busy. Try again later.'), null;
    let code = this.makeCode();
    for (let tries = 0; this.rooms.has(code); tries++) {
      if (tries > 50) return this.#error(session, 'busy', 'Could not create a room. Try again.'), null;
      code = this.makeCode();
    }
    const room = new Room({ ...this.roomOptions, ...options, code, clock: this.clock });
    this.rooms.set(code, room);
    return room;
  }

  #enter(session, room, wantedColor = null, name = null) {
    const joined = room.join(session.conn, wantedColor, name);
    session.room = room;
    session.token = joined.token;
  }

  #join(session, code, name = null) {
    this.#leave(session);
    const room = this.rooms.get(code);
    if (!room) return this.#error(session, 'no_such_room', 'No room with that code.');
    const joined = room.join(session.conn, null, name);
    if (joined.error) return this.#error(session, joined.error.code, joined.error.message);
    session.room = room;
    session.token = joined.token;
  }

  #rejoin(session, code, token) {
    const room = this.rooms.get(code);
    if (!room) return this.#error(session, 'no_such_room', 'That room no longer exists.');
    const result = room.rejoin(session.conn, token);
    if (result.error) return this.#error(session, result.error.code, result.error.message);
    session.room = room;
    session.token = token;
    result.replaced?.close?.();
  }

  #leave(session) {
    if (!session.room) return;
    session.room.leave(session.token);
    this.#dropIfEmpty(session.room);
    session.room = null;
    session.token = null;
  }

  // The connection closed. The person keeps their seat so they can come back.
  closed(session) {
    session.room?.disconnect(session.token, session.conn);
  }

  #dropIfEmpty(room) {
    if (!room.isEmpty()) return;
    room.destroy();
    this.rooms.delete(room.code);
  }

  // Removes rooms nobody is left in, or that nobody has been connected to for a long time.
  sweep() {
    const now = this.clock.now();
    for (const room of [...this.rooms.values()]) {
      const abandoned = room.idleSince !== null && now - room.idleSince >= this.limits.emptyRoomMs;
      if (room.isEmpty() || abandoned) {
        room.destroy();
        this.rooms.delete(room.code);
      }
    }
  }

  startSweeping() {
    this.#sweeper = setInterval(() => this.sweep(), this.limits.sweepMs);
    this.#sweeper.unref?.();
  }

  close() {
    if (this.#sweeper) clearInterval(this.#sweeper);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
