import { describe, it, expect } from 'vitest';
import { computeLayout, estimateTextWidth, MIN_TOUCH, reactionPanelLayout } from '../src/config/layout.js';
import { COOLDOWN_MS, REACTIONS, SHOW_MS, cooldownGroup, isReactionId, reactionById } from '../src/online/reactions.js';
import { parseClientMessage } from '../src/online/protocol.js';
import { OnlineSession } from '../src/online/OnlineSession.js';
import { Room } from '../server/Room.js';
import { RoomManager } from '../server/RoomManager.js';
import { FakeClock, FakeConn } from './fakes.js';
import { seeded } from './helpers.js';

describe('the list of things players can send', () => {
  it('has exactly the four messages, the two reactions and the five emojis asked for', () => {
    expect(REACTIONS.filter((r) => r.kind === 'chat').map((r) => r.text)).toEqual(['Good game!', 'Nice move!', 'Well played!', 'Hello!']);
    expect(REACTIONS.filter((r) => r.kind === 'reaction').map((r) => r.id)).toEqual(['laugh', 'celebrate']);
    expect(REACTIONS.filter((r) => r.kind === 'emoji').map((r) => r.emoji)).toEqual(['😂', '😍', '😎', '😭', '🎉']);
    expect(REACTIONS).toHaveLength(11);
    expect(new Set(REACTIONS.map((r) => r.id)).size).toBe(11);
  });

  it('looks reactions up only by their exact id', () => {
    expect(reactionById('gg').text).toBe('Good game!');
    for (const bad of ['GG', 'gg ', '', null, undefined, 3, {}, '__proto__', 'constructor', 'toString']) expect(isReactionId(bad), String(bad)).toBe(false);
  });

  it('limits chat to one every 2 s and reactions/emojis to one every 1 s, and shows things for 2-3 s', () => {
    expect(COOLDOWN_MS).toEqual({ chat: 2000, reaction: 1000, emoji: 1000 });
    expect(cooldownGroup('chat')).not.toBe(cooldownGroup('emoji'));
    expect(cooldownGroup('reaction')).toBe(cooldownGroup('emoji'));
    for (const ms of Object.values(SHOW_MS)) expect(ms).toBeGreaterThanOrEqual(2000) && expect(ms).toBeLessThanOrEqual(3000);
  });
});

describe('the react message', () => {
  const parse = (m) => parseClientMessage(JSON.stringify(m));

  it('passes a known id and nothing else from the message', () => {
    expect(parse({ t: 'react', id: 'love', seat: 'blue', name: 'Someone_Else', playerId: 'x' })).toEqual({ ok: true, msg: { t: 'react', id: 'love' } });
  });

  it('refuses unknown ids, free text and other types', () => {
    for (const id of ['hack', 'Good game!', '😂', 5, null, undefined, ['gg'], { id: 'gg' }]) {
      const r = parse({ t: 'react', id });
      expect(r.ok, JSON.stringify(id)).toBe(false);
      expect(r.error).toBe('unknown reaction');
    }
  });
});

// A started room with four people (red, green, yellow, blue) and a clock we control.
function playing({ people = 4 } = {}) {
  const clock = new FakeClock();
  let n = 0;
  const room = new Room({ code: 'BCDF', seats: 4, clock, rng: seeded(1), makeToken: () => `token-${++n}-`.padEnd(24, 'x') });
  const who = Array.from({ length: people }, (_, i) => {
    const conn = new FakeConn();
    const { token } = room.join(conn, null, ['Ann_1', 'Bob_2', 'Cy_3', 'Di_4'][i]);
    return { conn, token };
  });
  for (let i = people; i < 4; i++) room.handle(who[0].token, { t: 'addAi' });
  room.handle(who[0].token, { t: 'start' });
  return { room, clock, who };
}
const react = (room, p, id) => room.handle(p.token, { t: 'react', id });
const reactions = (p) => p.conn.sent.filter((m) => m.t === 'reaction');

describe('the server and reactions', () => {
  it('sends a reaction to everybody in the room, naming the sender\'s seat, id and name from its own records', () => {
    const { room, who } = playing();
    react(room, who[1], 'gg');
    const sender = room.members.get(who[1].token);
    for (const p of who) expect(reactions(p)).toEqual([{ t: 'reaction', seat: 'green', playerId: sender.id, name: 'Bob_2', id: 'gg' }]);
  });

  it('broadcasts every one of the eleven', () => {
    const { room, clock, who } = playing();
    for (const r of REACTIONS) {
      react(room, who[0], r.id);
      clock.advance(2000);
    }
    expect(reactions(who[3]).map((m) => m.id)).toEqual(REACTIONS.map((r) => r.id));
  });

  it('lets several players react at the same moment', () => {
    const { room, who } = playing();
    react(room, who[0], 'joy');
    react(room, who[1], 'love');
    react(room, who[2], 'hello');
    expect(reactions(who[3]).map((m) => [m.seat, m.id])).toEqual([['red', 'joy'], ['green', 'love'], ['yellow', 'hello']]);
  });

  it('drops a chat message sent within 2 s of the last one, and an emoji or reaction within 1 s, per player', () => {
    const { room, clock, who } = playing();
    react(room, who[0], 'gg');
    react(room, who[0], 'nice'); // too soon
    clock.advance(1999);
    react(room, who[0], 'wp'); // still too soon
    clock.advance(1);
    react(room, who[0], 'hello'); // 2 s later: fine
    react(room, who[0], 'joy'); // emojis have their own limit
    react(room, who[0], 'laugh'); // ...shared with reactions: too soon
    clock.advance(999);
    react(room, who[0], 'cool');
    clock.advance(1);
    react(room, who[0], 'celebrate');
    react(room, who[1], 'joy'); // another player is not held back by red's limit
    expect(reactions(who[2]).map((m) => [m.seat, m.id])).toEqual([['red', 'gg'], ['red', 'hello'], ['red', 'joy'], ['red', 'celebrate'], ['green', 'joy']]);
  });

  it('ignores a flood: a thousand sends in one second give one chat message and one emoji', () => {
    const { room, who } = playing();
    for (let i = 0; i < 500; i++) {
      react(room, who[0], 'gg');
      react(room, who[0], 'joy');
    }
    expect(reactions(who[1])).toHaveLength(2);
  });

  it('ignores reactions in the lobby, and from unknown or invalid senders, without an answer', () => {
    const clock = new FakeClock();
    const room = new Room({ code: 'BCDF', seats: 4, clock, rng: seeded(1) });
    const conn = new FakeConn();
    const { token } = room.join(conn, null, 'Ann_1');
    room.handle(token, { t: 'react', id: 'gg' }); // still in the lobby
    room.handle('not-a-member-token-xxxxxx', { t: 'react', id: 'gg' });
    room.handle(token, { t: 'react', id: 'not-a-reaction' }); // (the protocol refuses these before they get here)
    expect(conn.sent.filter((m) => m.t === 'reaction' || m.t === 'error')).toEqual([]);
  });

  it('ignores reactions from a player whose connection has dropped', () => {
    const { room, who } = playing();
    room.disconnect(who[0].token, who[0].conn);
    react(room, who[0], 'gg');
    expect(reactions(who[1])).toHaveLength(0);
  });

  it('never sends one room\'s reactions to another room', () => {
    const clock = new FakeClock();
    let codes = 0;
    const manager = new RoomManager({ clock, roomOptions: { rng: seeded(2) }, makeCode: () => ['BCDF', 'GHJK'][codes++] });
    const people = [];
    for (const [i, code] of [[0, null], [1, null]]) {
      void code;
      const conn = new FakeConn();
      const session = manager.newSession(conn);
      manager.route(session, { t: 'create', seats: 2, name: `Host_${i}` });
      manager.route(session, { t: 'addAi' });
      manager.route(session, { t: 'start' });
      people.push({ conn, session });
    }
    manager.route(people[0].session, { t: 'react', id: 'party' });
    expect(reactions(people[0])).toHaveLength(1);
    expect(reactions(people[1])).toHaveLength(0);
  });
});

describe('the session passes reactions on', () => {
  it('emits each reaction once, and a listener removed with its "off" hears no more (no duplicates after a screen is rebuilt)', async () => {
    let client;
    class FakeClient {
      constructor() { client = this; this.sent = []; this.connected = false; }
      connect() { this.connected = true; return Promise.resolve(); }
      send(m) { this.sent.push(m); return true; }
      close() {}
    }
    const session = new OnlineSession({ createClient: () => new FakeClient(), store: { load: () => null, save() {}, clear() {} }, getUrl: () => 'ws://x/ws', getName: () => null });
    await session.connect();
    const first = [];
    const off = session.on('reaction', (r) => first.push(r));
    client.onMessage({ t: 'reaction', seat: 'red', playerId: 'abc', name: 'Ann_1', id: 'gg' });
    off(); // the game screen was rebuilt (rotation, reconnect): its old listener goes...
    const second = [];
    session.on('reaction', (r) => second.push(r)); // ...and the new screen listens
    client.onMessage({ t: 'reaction', seat: 'green', playerId: 'def', name: 'Bob_2', id: 'joy' });
    expect(first).toEqual([{ seat: 'red', playerId: 'abc', name: 'Ann_1', id: 'gg' }]);
    expect(second).toEqual([{ seat: 'green', playerId: 'def', name: 'Bob_2', id: 'joy' }]);
    expect(session.react('love')).toBe(true);
    expect(client.sent.at(-1)).toEqual({ t: 'react', id: 'love' });
  });
});

describe('the reaction panel fits every screen', () => {
  for (const [w, h] of [[320, 480], [360, 640], [390, 844], [412, 915], [768, 1024], [667, 375], [844, 390], [1366, 768], [1920, 1080]]) {
    it(`${w}x${h}`, () => {
      const l = computeLayout(w, h);
      const p = reactionPanelLayout(l);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top + p.h).toBeLessThanOrEqual(l.height + 0.5);
      expect(p.cx - p.w / 2).toBeGreaterThanOrEqual(0);
      expect(p.cx + p.w / 2).toBeLessThanOrEqual(l.width + 0.5);
      expect(p.btnH * l.scale, 'button height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
      expect(p.emojiH * l.scale, 'emoji button height').toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
      expect(estimateTextWidth('Well played!'.length, p.btnFont)).toBeLessThanOrEqual(p.colW - 16);
      // every button inside the panel, none overlapping
      const rects = [
        ...[0, 1, 2, 3].map((i) => ({ ...p.chatAt(i), w: p.colW, h: p.btnH })),
        ...[0, 1].map((i) => ({ ...p.reactAt(i), w: p.colW, h: p.btnH })),
        ...[0, 1, 2, 3, 4].map((i) => ({ ...p.emojiAt(i), w: p.emojiW, h: p.emojiH })),
      ];
      for (const r of rects) {
        expect(r.x - r.w / 2).toBeGreaterThanOrEqual(p.cx - p.w / 2);
        expect(r.x + r.w / 2).toBeLessThanOrEqual(p.cx + p.w / 2 + 0.5);
        expect(r.y - r.h / 2).toBeGreaterThanOrEqual(p.top);
        expect(r.y + r.h / 2).toBeLessThanOrEqual(p.top + p.h + 0.5);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const apart = a.x + a.w / 2 <= b.x - b.w / 2 + 0.5 || b.x + b.w / 2 <= a.x - a.w / 2 + 0.5 || a.y + a.h / 2 <= b.y - b.h / 2 + 0.5 || b.y + b.h / 2 <= a.y - a.h / 2 + 0.5;
          expect(apart, `buttons ${i} and ${j} overlap`).toBe(true);
        }
      }
    });
  }
});
