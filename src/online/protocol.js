import { PLAYER_IDS } from '../game/path.js';
import { resolveRules } from '../game/rules.js';
import { LEVELS } from '../game/ai.js';
import { validateName } from '../game/playerName.js';
import { isReactionId } from './reactions.js';
import { PLAYER_COUNTS } from '../game/settings.js';

// The online multiplayer protocol, shared by the server and the game client. Messages are JSON objects with a
// type in `t`. Everything a client sends is untrusted: parseClientMessage() checks it strictly.
//
// Client -> server
//   create  { seats, rules?, difficulty?, name? }  open a room for 2-4 players
//   quick   { size, color?, name? }                   "Play online": join (or open) a public match for 2 or 4 players;
//                                              it starts when full, or after 20 s with computers in the empty seats.
//                                              `color` is the colour the person would like; they get it when it is free
//   join    { code, name? }                           join a room that is still in its lobby
//   rejoin  { code, token }                    come back to a room after a disconnect
//   color   { color }                          lobby: move to a free colour
//   addAi / removeAi { color? }                lobby, host: add or remove a computer player
//   start | rematch                            host: start the game / go back to the lobby
//   roll | move { index }                      play (only on your own turn)
//   react   { id }                             in a game: send a quick chat message, reaction or emoji (an id from reactions.js)
//   sync | leave | ping
//   `name` is the person's chosen name (3-16 letters, numbers or _); it is only a label to show, never an identity.
//
// Server -> client
//   joined  { code, token, color, preferred }  you are in; keep the token to rejoin. color is your SEAT; preferred is the colour you asked for
//                                              (several people may ask for the same one: each screen paints its own seat in it);
//                                              id is your public player id, name your name as the room knows it
//   room    { room }                           lobby/seat information, sent on every change; each seat has { color, kind ('human' | 'ai' | 'left'), id, name, status ('waiting' | 'playing' | 'finished' | 'left'), position, ... }
//   started { snapshot, seq }                  the game began (full state)
//   snapshot { snapshot, seq }                 full state again (after sync or rejoin)
//   rolled  { seq, player, value, auto, ai, autoMove, forfeited, phase, legal, timeoutMs? }   (timeoutMs: ms the person has to pick a token; autoMove: the server will play the only legal move)
//   moved   { seq, player, index, from, to, captured, finished, position, winner, rankings, auto, ai, forced }
//           (position: set when this move got the player's last token home: 1 for the first to finish, and so on; they take
//            no more turns. winner is the first to finish; rankings lists the seats in the order they finished, and holds
//            every seat when the game is over - only one player is left then, and they take the last position)
//   turn    { seq, player, extra, timeoutMs? }             the turn ended and play passes to `player`
//   left    { seq, player, over, winner, rankings }   a player left the running game (connection lost for good, or they quit): their
//                                              tokens are gone, they take no more turns and nobody plays their seat. over: that left only
//                                              one player, so the game is over (rankings then lists everybody, those who left last).
//                                              A 'turn' follows (seq + 1) when it was their turn and the game goes on.
//   reaction { seat, playerId, name, id }       somebody in this room sent a quick chat message, reaction or emoji
//                                              (not a numbered game event: it changes nothing in the game)
//   error   { code, message }   |   pong { seq }   |   closed { reason }

// Room codes use consonants only: no accidental words, nothing confusable with digits.
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;
export const MAX_MESSAGE_BYTES = 2048;
export const QUICK_SIZES = [2, 4]; // match sizes the server accepts for "Play online"
export const PLAY_ONLINE_SIZE = 4; // what the "Play online" button asks for (no choice is offered)

export const normalizeCode = (value) => String(value ?? '').toUpperCase().trim();

export const isRoomCode = (value) =>
  typeof value === 'string' && value.length === ROOM_CODE_LENGTH && [...value].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const isToken = (value) => typeof value === 'string' && TOKEN_PATTERN.test(value);

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isColor = (v) => typeof v === 'string' && PLAYER_IDS.includes(v);
// The optional name a person sends along; an invalid one is refused with the reason, never quietly changed.
const cleanName = (value) => {
  const checked = validateName(value);
  if (!checked.ok) throw `invalid name: ${checked.error}`;
  return checked.name;
};
const withName = (m, out) => (m.name === undefined ? out : { ...out, name: cleanName(m.name) });

// Per message type: returns the cleaned message, or throws a string describing what is wrong.
const SCHEMAS = {
  create(m) {
    if (!PLAYER_COUNTS.includes(m.seats)) throw 'seats must be 2, 3 or 4';
    const out = { t: 'create', seats: m.seats };
    if (m.rules !== undefined) {
      if (typeof m.rules !== 'object' || m.rules === null || Array.isArray(m.rules)) throw 'rules must be an object';
      try {
        out.rules = { ...resolveRules(m.rules) };
      } catch (e) {
        throw `invalid rules: ${e.message}`;
      }
    }
    if (m.difficulty !== undefined) {
      if (!LEVELS.includes(m.difficulty)) throw 'unknown difficulty';
      out.difficulty = m.difficulty;
    }
    return withName(m, out);
  },
  quick(m) {
    if (!QUICK_SIZES.includes(m.size)) throw 'size must be 2 or 4';
    const out = { t: 'quick', size: m.size };
    if (m.color !== undefined) {
      if (!isColor(m.color)) throw 'invalid colour';
      out.color = m.color;
    }
    return withName(m, out);
  },
  join(m) {
    const code = normalizeCode(m.code);
    if (!isRoomCode(code)) throw 'invalid room code';
    return withName(m, { t: 'join', code });
  },
  rejoin(m) {
    const code = normalizeCode(m.code);
    if (!isRoomCode(code)) throw 'invalid room code';
    if (!isToken(m.token)) throw 'invalid token';
    return { t: 'rejoin', code, token: m.token };
  },
  color(m) {
    if (!isColor(m.color)) throw 'invalid colour';
    return { t: 'color', color: m.color };
  },
  addAi: (m) => ({ t: m.t }),
  removeAi(m) {
    if (!isColor(m.color)) throw 'invalid colour';
    return { t: 'removeAi', color: m.color };
  },
  start: (m) => ({ t: m.t }),
  rematch: (m) => ({ t: m.t }),
  roll: (m) => ({ t: m.t }),
  move(m) {
    if (!isInt(m.index, 0, 3)) throw 'invalid token index';
    return { t: 'move', index: m.index };
  },
  react(m) {
    if (!isReactionId(m.id)) throw 'unknown reaction';
    return { t: 'react', id: m.id };
  },
  sync: (m) => ({ t: m.t }),
  leave: (m) => ({ t: m.t }),
  ping: (m) => ({ t: m.t }),
};

// Parses and validates a message received from a client. Never throws.
// Returns { ok: true, msg } or { ok: false, error }.
export function parseClientMessage(raw) {
  try {
    // ws delivers text frames as Buffers (which are Uint8Arrays), so decode those; anything else is not text.
    const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : null;
    if (text === null) return { ok: false, error: 'messages must be text' };
    if (text.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
    const m = JSON.parse(text);
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return { ok: false, error: 'message must be an object' };
    if (typeof m.t !== 'string' || !Object.hasOwn(SCHEMAS, m.t)) return { ok: false, error: 'unknown message type' };
    return { ok: true, msg: SCHEMAS[m.t](m) };
  } catch (e) {
    return { ok: false, error: typeof e === 'string' ? e : 'malformed message' };
  }
}
