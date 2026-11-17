import { describe, it, expect } from 'vitest';
import { Room, DEFAULT_CONFIG } from '../server/Room.js';
import { GameState, PHASE } from '../src/game/GameState.js';
import { chooseMove } from '../src/game/ai.js';
import { FakeClock, FakeConn } from './fakes.js';
import { rngFor, seeded } from './helpers.js';

const CFG = DEFAULT_CONFIG;

// Builds a room with a fake clock and predictable tokens.
function setup({ seats = 4, rng = seeded(1), config, rules, difficulty } = {}) {
  const clock = new FakeClock();
  let n = 0;
  const room = new Room({ code: 'BCDF', seats, clock, rng, config, rules, difficulty, makeToken: () => `token-${++n}-`.padEnd(24, 'x') });
  return { room, clock };
}
// Joins `count` people; returns [{ conn, token }].
function people(room, count) {
  return Array.from({ length: count }, () => {
    const conn = new FakeConn();
    const { token } = room.join(conn);
    return { conn, token };
  });
}
const ROLL = (room, who) => room.handle(who.token, { t: 'roll' });
const MOVE = (room, who, index) => room.handle(who.token, { t: 'move', index });
const errorCode = (conn) => conn.last('error')?.code;

describe('lobby', () => {
  it('seats people in colour order; the first is the host', () => {
    const { room } = setup();
    const [a, b, c] = people(room, 3);
    expect([a, b, c].map((p) => p.conn.last('joined').color)).toEqual(['red', 'green', 'yellow']);
    const info = a.conn.last('room').room;
    expect(info.code).toBe('BCDF');
    expect(info.you).toBe('red');
    expect(info.seats.map((s) => [s.color, s.kind, s.host])).toEqual([['red', 'human', true], ['green', 'human', false], ['yellow', 'human', false]]);
    expect(b.conn.last('room').room.you).toBe('green');
  });

  it('gives each person a distinct secret token and does not leak it to others', () => {
    const { room } = setup();
    const [a, b] = people(room, 2);
    expect(a.token).not.toBe(b.token);
    expect(JSON.stringify(b.conn.sent)).not.toContain(a.token);
  });

  it('refuses a full room and a game already in progress', () => {
    const { room } = setup({ seats: 2 });
    const [host] = people(room, 2);
    const late = new FakeConn();
    expect(room.join(late).error.code).toBe('room_full');
    room.handle(host.token, { t: 'start' });
    const latecomer = new FakeConn();
    expect(room.join(latecomer).error.code).toBe('in_progress');
  });

  it('lets someone move to a free colour but not a taken one', () => {
    const { room } = setup();
    const [a, b] = people(room, 2);
    room.handle(b.token, { t: 'color', color: 'blue' });
    expect(b.conn.last('room').room.you).toBe('blue');
    room.handle(a.token, { t: 'color', color: 'blue' });
    expect(errorCode(a.conn)).toBe('color_taken');
    room.handle(a.token, { t: 'color', color: 'red' }); // keeping your own colour is fine
    expect(errorCode(a.conn)).toBe('color_taken');
  });

  it('lets only the host add and remove computer players, within the seat limit', () => {
    const { room } = setup({ seats: 3 });
    const [host, guest] = people(room, 2);
    room.handle(guest.token, { t: 'addAi' });
    expect(errorCode(guest.conn)).toBe('not_host');
    room.handle(host.token, { t: 'addAi' });
    expect(host.conn.last('room').room.seats.map((s) => [s.color, s.kind])).toEqual([['red', 'human'], ['green', 'human'], ['yellow', 'ai']]);
    room.handle(host.token, { t: 'addAi' });
    expect(errorCode(host.conn)).toBe('room_full');
    room.handle(host.token, { t: 'removeAi', color: 'yellow' });
    expect(host.conn.last('room').room.seats).toHaveLength(2);
    room.handle(host.token, { t: 'removeAi', color: 'blue' });
    expect(errorCode(host.conn)).toBe('no_such_seat');
  });

  it('starts only for the host, with at least two seats taken', () => {
    const { room } = setup();
    const [host, guest] = people(room, 1).concat(people(room, 1));
    room.handle(guest.token, { t: 'start' });
    expect(errorCode(guest.conn)).toBe('not_host');
    const solo = setup();
    const [only] = people(solo.room, 1);
    solo.room.handle(only.token, { t: 'start' });
    expect(errorCode(only.conn)).toBe('not_enough_players');
    room.handle(host.token, { t: 'start' });
    expect(host.conn.last('started').snapshot.players).toEqual(['red', 'green']);
    expect(room.phase).toBe('playing');
  });

  it('starts with one person and a computer, and seats play in clockwise colour order', () => {
    const { room } = setup();
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'color', color: 'yellow' });
    room.handle(host.token, { t: 'addAi' }); // takes red
    room.handle(host.token, { t: 'start' });
    expect(host.conn.last('started').snapshot.players).toEqual(['red', 'yellow']);
  });

  it('starts with the room rules', () => {
    const { room } = setup({ rules: { blockades: true } });
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'addAi' });
    room.handle(host.token, { t: 'start' });
    expect(host.conn.last('started').snapshot.rules.blockades).toBe(true);
  });

  it('cannot change the lobby once the game has started', () => {
    const { room } = setup();
    const [host, guest] = people(room, 2);
    room.handle(host.token, { t: 'start' });
    room.handle(guest.token, { t: 'color', color: 'blue' });
    expect(errorCode(guest.conn)).toBe('bad_phase');
    room.handle(host.token, { t: 'addAi' });
    expect(errorCode(host.conn)).toBe('bad_phase');
  });

  it('frees a lobby seat when someone leaves, and passes host to the next person', () => {
    const { room } = setup();
    const [a, b] = people(room, 2);
    room.leave(a.token);
    const info = b.conn.last('room').room;
    expect(info.seats.map((s) => [s.color, s.host])).toEqual([['green', true]]);
    const [c] = people(room, 1);
    expect(c.conn.last('joined').color).toBe('red'); // the freed colour is reused
  });
});

describe('playing: rules enforced by the server', () => {
  // red (host) and green, red to move first
  const twoPlayers = (rng) => {
    const t = setup({ seats: 2, rng });
    const [red, green] = people(t.room, 2);
    t.room.handle(red.token, { t: 'start' });
    return { ...t, red, green };
  };

  it('rejects actions from the wrong player or in the wrong phase, without changing the game', () => {
    const { room, red, green } = twoPlayers(rngFor(6));
    const before = JSON.stringify(room.state.snapshot());
    ROLL(room, green);
    expect(errorCode(green.conn)).toBe('not_your_turn');
    MOVE(room, red, 0);
    expect(errorCode(red.conn)).toBe('bad_phase'); // must roll first
    expect(JSON.stringify(room.state.snapshot())).toBe(before);
    ROLL(room, red);
    ROLL(room, red);
    expect(errorCode(red.conn)).toBe('bad_phase'); // already rolled
    MOVE(room, green, 0);
    expect(errorCode(green.conn)).toBe('not_your_turn');
  });

  it('rejects an illegal token and accepts a legal one', () => {
    const { room, red } = twoPlayers(rngFor(6));
    ROLL(room, red);
    expect(red.conn.last('rolled').legal).toEqual([0, 1, 2, 3]);
    room.state.tokens.red[0] = 56; // make token 0 unmovable (finished)
    MOVE(room, red, 0);
    expect(errorCode(red.conn)).toBe('illegal_move');
    MOVE(room, red, 1);
    expect(red.conn.last('moved')).toMatchObject({ player: 'red', index: 1, from: -1, to: 0, captured: [] });
  });

  it('broadcasts every event to everyone, in order, with consecutive sequence numbers', () => {
    const { room, red, green } = twoPlayers(rngFor(6));
    ROLL(room, red);
    MOVE(room, red, 0);
    for (const who of [red, green]) {
      const events = who.conn.sent.filter((m) => ['rolled', 'moved', 'turn'].includes(m.t));
      expect(events.map((e) => e.t)).toEqual(['rolled', 'moved', 'turn']);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    }
    expect(red.conn.last('turn')).toMatchObject({ player: 'red', extra: true }); // a 6 earns another roll
  });

  it('passes the turn automatically when nothing can move', () => {
    const { room, red, green } = twoPlayers(rngFor(3));
    ROLL(room, red);
    expect(green.conn.last('rolled')).toMatchObject({ value: 3, phase: 'end', legal: [] });
    expect(green.conn.last('turn')).toMatchObject({ player: 'green', extra: false });
    expect(room.state.currentPlayer).toBe('green');
  });

  it('voids a third six and passes the turn', () => {
    const { room, red } = twoPlayers(rngFor(6));
    for (let i = 0; i < 2; i++) {
      ROLL(room, red);
      MOVE(room, red, i);
    }
    ROLL(room, red);
    expect(red.conn.last('rolled')).toMatchObject({ value: 6, forfeited: true, phase: 'end' });
    expect(room.state.currentPlayer).toBe('green');
  });

  it('announces captures', () => {
    const { room, red } = twoPlayers(rngFor(2));
    room.state.tokens.red = [1, -1, -1, -1];
    room.state.tokens.green = [(3 - 13 + 52) % 52, -1, -1, -1]; // a green token on track cell 3
    ROLL(room, red);
    MOVE(room, red, 0);
    expect(red.conn.last('moved').captured).toEqual([{ player: 'green', index: 0 }]);
    expect(room.state.tokens.green[0]).toBe(-1);
  });

  it('ends the game on a win, then goes back to the lobby on rematch (host only)', () => {
    const { room, red, green } = twoPlayers(rngFor(1));
    room.state.tokens.red = [56, 56, 56, 55];
    ROLL(room, red);
    MOVE(room, red, 3);
    expect(red.conn.last('moved').winner).toBe('red');
    expect(room.phase).toBe('over');
    ROLL(room, red);
    expect(errorCode(red.conn)).toBe('bad_phase');
    room.handle(green.token, { t: 'rematch' });
    expect(errorCode(green.conn)).toBe('not_host');
    room.handle(red.token, { t: 'rematch' });
    expect(room.phase).toBe('lobby');
    expect(red.conn.last('room').room.phase).toBe('lobby');
    expect(red.conn.last('room').room.seats).toHaveLength(2); // the seats stay
    room.handle(red.token, { t: 'start' });
    expect(room.phase).toBe('playing');
    expect(room.state.tokens.red).toEqual([-1, -1, -1, -1]); // a fresh game
  });

  it('answers sync with the full state', () => {
    const { room, red } = twoPlayers(rngFor(6));
    ROLL(room, red);
    red.conn.clear();
    room.handle(red.token, { t: 'sync' });
    expect(red.conn.last('snapshot')).toMatchObject({ seq: 1, snapshot: room.state.snapshot() });
  });

  it('ignores messages from people who are not in the room', () => {
    const { room } = twoPlayers(rngFor(6));
    const before = JSON.stringify(room.state.snapshot());
    room.handle('no-such-token', { t: 'roll' });
    expect(JSON.stringify(room.state.snapshot())).toBe(before);
  });
});

describe('computer seats and timers', () => {
  it('plays a computer seat by itself, with pauses, and then waits for the person', () => {
    const { room, clock } = setup({ rng: rngFor(3), config: { aiThinkMinMs: null, aiThinkMaxMs: null } }); // (a fixed think time here; the random one is tested below)
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'addAi' }); // green is a computer
    room.handle(host.token, { t: 'start' });
    ROLL(room, host); // red rolls a 3: nothing moves, turn passes to the computer
    expect(room.state.currentPlayer).toBe('green');
    host.conn.clear();
    clock.advance(CFG.aiThinkMs - 1);
    expect(host.conn.sent).toHaveLength(0); // still thinking
    clock.advance(1);
    expect(host.conn.last('rolled')).toMatchObject({ player: 'green', ai: true });
    expect(room.state.currentPlayer).toBe('red'); // back to the person
    clock.advance(CFG.aiThinkMs * 5);
    expect(room.state.currentPlayer).toBe('red'); // and it waits for them
  });

  it('makes a computer seat wait a random 2 to 5 seconds before it rolls, a different time each turn', () => {
    expect([CFG.aiThinkMinMs, CFG.aiThinkMaxMs]).toEqual([2000, 5000]);
    for (const [draw, ms] of [[0, 2000], [0.5, 3500], [0.999, 4997]]) {
      const clock = new FakeClock();
      let n = 0;
      const room = new Room({ code: 'BCDF', seats: 2, clock, rng: rngFor(3), thinkRng: () => draw, makeToken: () => `token-${++n}-`.padEnd(24, 'x') });
      const host = new FakeConn();
      const { token } = room.join(host);
      room.handle(token, { t: 'addAi' }); // green is a computer
      room.handle(token, { t: 'start' });
      room.handle(token, { t: 'roll' }); // red rolls a 3: the turn passes to the computer
      host.clear();
      clock.advance(ms - 1);
      expect(host.of('rolled'), `still thinking at ${ms - 1} ms`).toHaveLength(0);
      clock.advance(1);
      expect(host.last('rolled'), `rolled at ${ms} ms`).toMatchObject({ player: 'green', ai: true });
    }
  });

  it('draws the waits from its own random numbers, so the bots never change the dice', () => {
    const run = (thinkRng) => {
      const clock = new FakeClock();
      const room = new Room({ code: 'BCDF', seats: 2, clock, rng: seeded(9), thinkRng, makeToken: () => 'token-x'.padEnd(24, 'x') });
      const conn = new FakeConn();
      room.join(conn);
      room.handle(room.members.keys().next().value, { t: 'addAi' });
      room.handle(room.members.keys().next().value, { t: 'start' });
      for (let i = 0; i < 400; i++) clock.advance(500);
      return conn.of('rolled').map((m) => m.value).slice(0, 10);
    };
    expect(run(() => 0)).toEqual(run(() => 0.99)); // same dice whatever the bots' waits are
  });
  it('pauses before the computer moves a token', () => {
    const { room, clock } = setup({ rng: rngFor(6), config: { aiThinkMinMs: null, aiThinkMaxMs: null } });
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'color', color: 'green' });
    room.handle(host.token, { t: 'addAi' }); // red is the computer and moves first
    room.handle(host.token, { t: 'start' });
    clock.advance(CFG.aiThinkMs);
    expect(host.conn.last('rolled')).toMatchObject({ player: 'red', ai: true, phase: 'move' });
    expect(host.conn.of('moved')).toHaveLength(0);
    clock.advance(CFG.aiPickMs);
    expect(host.conn.last('moved')).toMatchObject({ player: 'red', ai: true });
  });

  it('plays for a person who runs out of time, but then still gives them their time on their next turns (not instant play)', () => {
    const { room, clock } = setup({ rng: rngFor(6) });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    clock.advance(CFG.turnTimeoutMs - 1);
    expect(red.conn.of('rolled')).toHaveLength(0);
    clock.advance(1);
    expect(red.conn.last('rolled')).toMatchObject({ player: 'red', auto: true });
    expect(room.info(room.members.get(red.token)).seats[0].away).toBe(true);
    clock.advance(CFG.aiPickMs); // the rest of that same turn is played quickly, not after another 15 s
    expect(red.conn.last('moved')).toMatchObject({ player: 'red', auto: true });
    expect(green.conn.last('moved').player).toBe('red');

    // A 6 gives red another turn. This time the person still gets their time, not a computer in 1 second.
    const rolls = red.conn.of('rolled').length;
    clock.advance(CFG.awayTimeoutMs - 1);
    expect(red.conn.of('rolled')).toHaveLength(rolls);
    clock.advance(1);
    expect(red.conn.of('rolled')).toHaveLength(rolls + 1);
  });

  it('lets an away person take their turn themselves within their time, and then they are no longer away', () => {
    const { room, clock } = setup({ rng: rngFor(6) });
    const [red] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    clock.advance(CFG.turnTimeoutMs + CFG.aiPickMs); // times out once: auto roll and move, red keeps the turn after a 6
    const rolls = red.conn.of('rolled').length;
    clock.advance(CFG.aiThinkMs * 3); // a computer would have acted by now, but the person is being waited for
    expect(red.conn.of('rolled')).toHaveLength(rolls);
    ROLL(room, red); // the person acts in time
    expect(red.conn.of('rolled')).toHaveLength(rolls + 1);
    expect(red.conn.last('rolled').auto).toBeUndefined();
    expect(room.members.get(red.token).away).toBe(false);
  });
  it('takes a person off "away" as soon as they act', () => {
    const { room, clock } = setup({ rng: rngFor(3) });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    clock.advance(CFG.turnTimeoutMs); // red auto-rolls a 3, then green's turn
    expect(room.members.get(red.token).away).toBe(true);
    ROLL(room, green); // green is a person and acts; red is still away until red acts
    expect(room.state.currentPlayer).toBe('red');
    clock.advance(CFG.aiThinkMs);
    expect(room.members.get(red.token).away).toBe(true);
    clock.advance(CFG.turnTimeoutMs); // green's turn again, now red has not acted
    ROLL(room, green);
    ROLL(room, red);
    expect(room.members.get(red.token).away).toBe(false);
  });

  it('can play a whole game with only computers and one watcher (smoke test)', () => {
    const { room, clock } = setup({ seats: 4, rng: seeded(21) });
    const [host] = people(room, 1);
    for (let i = 0; i < 3; i++) room.handle(host.token, { t: 'addAi' });
    room.handle(host.token, { t: 'start' });
    // The host (red) is a person; let them time out so the computer plays for them too.
    for (let i = 0; i < 60000 && room.phase === 'playing'; i++) clock.advance(1000);
    expect(room.phase).toBe('over');
    expect(host.conn.last('moved').winner).toBeTruthy();
  });
});

describe('disconnecting and coming back', () => {
  it('plays for a disconnected person, and gives them the full state when they return (leave rule off)', () => {
    const { room, clock } = setup({ rng: seeded(5), config: { disconnectLeaveMs: null } });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    room.disconnect(red.token, red.conn);
    expect(green.conn.last('room').room.seats[0].connected).toBe(false);
    clock.advance(CFG.disconnectGraceMs - 1);
    expect(green.conn.sent.some((m) => m.t === 'rolled')).toBe(false); // red may be back in a moment: wait
    clock.advance(CFG.aiPickMs + 10); // the grace is over: the computer acts for red
    expect(green.conn.sent.some((m) => m.t === 'rolled' && m.ai)).toBe(true);

    const back = new FakeConn();
    const res = room.rejoin(back, red.token);
    expect(res.token).toBe(red.token);
    expect(back.last('joined')).toMatchObject({ code: 'BCDF', color: 'red', token: red.token });
    expect(back.last('snapshot').snapshot).toEqual(room.state.snapshot());
    expect(back.last('room').room.you).toBe('red');
    expect(green.conn.last('room').room.seats[0].connected).toBe(true);
  });

  it('lets a person who reconnects within the grace period play their turn themselves', () => {
    const { room, clock } = setup({ rng: seeded(8) });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    room.disconnect(red.token, red.conn);
    clock.advance(CFG.disconnectGraceMs - 500);
    const back = new FakeConn();
    room.rejoin(back, red.token); // a quick Wi-Fi blip: back before the grace ran out
    clock.advance(CFG.disconnectGraceMs * 2);
    expect(green.conn.sent.some((m) => m.t === 'rolled' && m.ai)).toBe(false); // the computer never played for them
    ROLL(room, red);
    expect(back.last('rolled')).toMatchObject({ player: 'red' });
  });

  it('plays quickly for someone who has been gone longer than the grace period (leave rule off)', () => {
    const { room, clock } = setup({ rng: rngFor(3), config: { disconnectLeaveMs: null } });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    room.disconnect(red.token, red.conn);
    clock.advance(CFG.disconnectGraceMs + 1000); // red's first turn is played; green's turn comes (a person: waits)
    ROLL(room, green); // green rolls a 3 (nothing to move) and it is red's turn again
    const rolls = green.conn.of('rolled').length;
    clock.advance(CFG.aiThinkMs); // red has been gone for longer than the grace: no extra wait this time
    expect(green.conn.of('rolled').length).toBeGreaterThan(rolls);
  });
  it('refuses a wrong token and tells an old connection it was replaced', () => {
    const { room } = setup();
    const [a] = people(room, 2);
    expect(room.rejoin(new FakeConn(), 'wrong-token-wrong-token-1').error.code).toBe('bad_token');
    const second = new FakeConn();
    room.rejoin(second, a.token);
    expect(a.conn.last('closed')).toMatchObject({ reason: 'replaced' });
  });

  it('ignores a disconnect from a connection that has already been replaced', () => {
    const { room } = setup();
    const [a] = people(room, 2);
    const second = new FakeConn();
    room.rejoin(second, a.token);
    room.disconnect(a.token, a.conn);
    expect(room.members.get(a.token).conn).toBe(second);
  });

  it('pauses the game when nobody is connected, and carries on when someone returns', () => {
    const { room, clock } = setup({ rng: seeded(3) });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    room.disconnect(red.token, red.conn);
    room.disconnect(green.token, green.conn);
    const seq = room.seq;
    clock.advance(10 * 60_000);
    expect(room.seq).toBe(seq); // nothing was played alone, and nobody was made to leave
    expect(room.members.size).toBe(2);
    expect(room.idleSince).not.toBeNull();
    room.rejoin(new FakeConn(), green.token);
    expect(room.idleSince).toBeNull();
    clock.advance(CFG.disconnectLeaveMs + 1000); // red is still away: now they have left and green is alone in the game
    expect(room.seq).toBeGreaterThan(seq);
    expect(room.phase).toBe('over');
  });

  it('keeps a lobby seat for a while, then frees it', () => {
    const { room, clock } = setup();
    const [a, b] = people(room, 2);
    room.disconnect(b.token, b.conn);
    clock.advance(CFG.lobbyGraceMs - 1);
    expect(room.members.has(b.token)).toBe(true);
    const back = new FakeConn();
    expect(room.rejoin(back, b.token).token).toBe(b.token); // came back in time
    room.disconnect(b.token, back);
    clock.advance(CFG.lobbyGraceMs);
    expect(room.members.has(b.token)).toBe(false);
    expect(a.conn.last('room').room.seats).toHaveLength(1);
  });

  it('takes a person who leaves mid-game out completely: the computer does not take the seat (a 2-player game is then won by the other)', () => {
    const { room, clock } = setup({ rng: seeded(2) });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    room.leave(green.token);
    expect(red.conn.last('room').room.seats.map((s) => s.kind)).toEqual(['human', 'left']);
    expect(red.conn.last('left')).toMatchObject({ player: 'green', over: true, winner: 'red', rankings: ['red', 'green'] });
    expect(room.members.has(green.token)).toBe(false);
    expect(room.ais.size).toBe(0);
    expect(room.phase).toBe('over');
    expect(room.info(room.members.get(red.token)).seats[0].host).toBe(true);
    const seq = room.seq;
    clock.advance(CFG.turnTimeoutMs * 4);
    expect(room.seq).toBe(seq); // nobody plays on for green
  });

  it('passes host to the next person when the host leaves', () => {
    const { room } = setup();
    const [a, b] = people(room, 2);
    room.leave(a.token);
    expect(room.members.get(b.token).host).toBe(true);
    room.handle(b.token, { t: 'addAi' });
    expect(b.conn.last('error')).toBeUndefined();
  });

  it('reports itself empty once everyone has left', () => {
    const { room } = setup();
    const [a, b] = people(room, 2);
    expect(room.isEmpty()).toBe(false);
    room.leave(a.token);
    room.leave(b.token);
    expect(room.isEmpty()).toBe(true);
  });
});

describe('clients that replay the events end up with exactly the server state', () => {
  it('for complete 4-seat games with people, timeouts and a computer', () => {
    for (const seed of [11, 12, 13]) {
      const rng = seeded(seed);
      const { room, clock } = setup({ seats: 4, rng, rules: seed === 12 ? { blockades: true } : undefined });
      const humans = people(room, 3);
      room.handle(humans[0].token, { t: 'addAi' });
      room.handle(humans[0].token, { t: 'start' });

      // Each client keeps its own GameState and applies the broadcast events, as the real client will.
      const replicas = humans.map(({ conn }) => ({ conn, state: null, applied: 0 }));
      const apply = (replica, m) => {
        if (m.t === 'started' || m.t === 'snapshot') replica.state = GameState.fromSnapshot(m.snapshot);
        else if (m.t === 'rolled') {
          replica.state.rollDice(rngFor(m.value));
          expect(replica.state.phase).toBe(m.phase);
        } else if (m.t === 'moved') {
          const r = replica.state.moveToken(m.index);
          expect({ from: r.from, to: r.to, captured: r.captured }).toEqual({ from: m.from, to: m.to, captured: m.captured });
        } else if (m.t === 'turn') {
          expect(replica.state.endTurn()).toBe(m.extra);
          expect(replica.state.currentPlayer).toBe(m.player);
        }
      };
      const pump = () => {
        for (const replica of replicas) {
          while (replica.applied < replica.conn.sent.length) apply(replica, replica.conn.sent[replica.applied++]);
        }
      };

      for (let step = 0; step < 20000 && room.phase === 'playing'; step++) {
        pump();
        const current = room.state.currentPlayer;
        const who = humans.find((h) => room.members.get(h.token).color === current);
        // The people play themselves (using the computer's choice) most of the time; sometimes they stall.
        if (who && rng() < 0.6) {
          if (room.state.phase === PHASE.ROLL) ROLL(room, who);
          else MOVE(room, who, chooseMove(room.state, 'normal', rng));
        } else {
          clock.advance(rng() < 0.2 ? CFG.turnTimeoutMs : CFG.aiPickMs + CFG.aiThinkMs);
        }
      }
      pump();
      expect(room.phase, `seed ${seed}`).toBe('over');
      for (const replica of replicas) expect(replica.state.snapshot(), `seed ${seed}`).toEqual(room.state.snapshot());
      expect(replicas[0].state.winner).toBe(room.state.winner);
    }
  });
});

describe('auto-playing a single legal move on the server', () => {
  const start = (config) => {
    const t = setup({ seats: 2, rng: rngFor(3), config });
    const [red, green] = people(t.room, 2);
    t.room.handle(red.token, { t: 'start' });
    t.room.state.tokens.red = [10, -1, -1, -1]; // exactly one legal move on a 3
    return { ...t, red, green };
  };

  it('announces it with the roll and plays it after a short pause, flagged as forced', () => {
    const { room, clock, red, green } = start();
    ROLL(room, red);
    expect(green.conn.last('rolled')).toMatchObject({ player: 'red', phase: 'move', legal: [0], autoMove: true });
    expect(red.conn.of('moved')).toHaveLength(0);
    clock.advance(CFG.aiPickMs - 1);
    expect(red.conn.of('moved')).toHaveLength(0);
    clock.advance(1);
    expect(green.conn.last('moved')).toMatchObject({ player: 'red', index: 0, from: 10, to: 13, forced: true });
    expect(room.state.currentPlayer).toBe('green');
  });

  it('does not play for a person who has several choices', () => {
    const { room, clock, red } = start();
    room.state.tokens.red = [10, 20, -1, -1];
    ROLL(room, red);
    expect(red.conn.last('rolled').autoMove).toBeUndefined();
    clock.advance(CFG.aiPickMs * 3);
    expect(red.conn.of('moved')).toHaveLength(0); // still waiting for the person (until the idle timeout)
  });

  it('accepts the person\'s own move if they are quicker than the server, without playing twice', () => {
    const { room, clock, red } = start();
    ROLL(room, red);
    MOVE(room, red, 0);
    clock.advance(CFG.aiPickMs * 5);
    expect(red.conn.of('moved')).toHaveLength(1);
    expect(room.state.tokens.red[0]).toBe(13);
  });

  it('can be switched off', () => {
    const { room, clock, red } = start({ autoSingleMove: false });
    ROLL(room, red);
    expect(red.conn.last('rolled').autoMove).toBeUndefined();
    clock.advance(CFG.aiPickMs * 3);
    expect(red.conn.of('moved')).toHaveLength(0);
  });

  it('leaves computer seats and absent people to the usual computer pacing', () => {
    const { room, clock, red, green } = start();
    room.config.disconnectLeaveMs = null; // (the older rule: the computer plays for someone who is away)
    room.disconnect(red.token, red.conn); // red is away from the game
    clock.advance(CFG.disconnectGraceMs); // after the grace period the computer rolls for red
    expect(green.conn.last('rolled').autoMove).toBeUndefined();
    expect(green.conn.last('rolled').ai).toBe(true);
  });
});

describe('the turn countdown', () => {
  const twoPeople = (rng = rngFor(3), options = {}) => {
    const { room, clock } = setup({ rng, ...options });
    const [red, green] = people(room, 2);
    room.handle(red.token, { t: 'start' });
    return { room, clock, red, green };
  };

  it('is 15 seconds, also for a person who timed out before', () => {
    expect(CFG.turnTimeoutMs).toBe(15_000);
    expect(CFG.awayTimeoutMs).toBe(15_000);
  });

  it('is announced with the first turn when a person starts, and not when a computer does', () => {
    const { red } = twoPeople();
    expect(red.conn.last('started').timeoutMs).toBe(15_000);

    const { room } = setup({ rng: rngFor(3) });
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'color', color: 'green' });
    room.handle(host.token, { t: 'addAi' }); // red is a computer and moves first
    room.handle(host.token, { t: 'start' });
    expect(host.conn.last('started').timeoutMs).toBeUndefined();
  });

  it('is sent with the turn event for a person, and not for a computer', () => {
    const { room, red, clock } = twoPeople(rngFor(3));
    ROLL(room, red); // a 3: nothing moves, the turn passes to green (a person)
    expect(red.conn.last('turn')).toMatchObject({ player: 'green', timeoutMs: 15_000 });

    const { room: room2 } = setup({ rng: rngFor(3) });
    const [host] = people(room2, 1);
    room2.handle(host.token, { t: 'addAi' }); // green is a computer
    room2.handle(host.token, { t: 'start' });
    ROLL(room2, host);
    expect(host.conn.last('turn')).toMatchObject({ player: 'green' });
    expect(host.conn.last('turn').timeoutMs).toBeUndefined();
    expect(clock.pending).toBeGreaterThan(0);
  });

  it('is sent again, in full, with the roll when a person has a token to choose', () => {
    const { room, red, green, clock } = twoPeople(rngFor(6));
    clock.advance(10_000); // red has used 10 of the 15 seconds without rolling
    ROLL(room, red); // a 6: four tokens could leave the yard, so red must choose
    expect(red.conn.last('rolled')).toMatchObject({ player: 'red', phase: 'move', timeoutMs: 15_000 });
    expect(green.conn.last('rolled').timeoutMs).toBe(15_000); // every screen gets it
    clock.advance(14_999);
    expect(red.conn.of('moved')).toHaveLength(0);
    clock.advance(1);
    expect(red.conn.last('moved')).toMatchObject({ player: 'red', auto: true }); // time is up: the computer chooses
  });

  it('is not sent when nobody is being waited for (no legal move, a computer, a move the server plays by itself)', () => {
    const { room, red } = twoPeople(rngFor(3));
    ROLL(room, red); // no legal move
    expect(red.conn.last('rolled').timeoutMs).toBeUndefined();
  });

  it('ends with the computer rolling and then playing its BEST move for the person, whatever the room skill is', () => {
    let compared = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { room, clock, red } = twoPeople(seeded(seed), { difficulty: 'easy' }); // easy would choose at random
      room.state.tokens.red = [5, 20, 40, -1];
      room.state.tokens.green = [18, 30, -1, -1];
      clock.advance(CFG.turnTimeoutMs); // the countdown ends: the computer rolls for red
      expect(red.conn.last('rolled')).toMatchObject({ player: 'red', auto: true });
      if (room.state.phase !== 'move' || room.state.legalMoves().length < 2) continue; // nothing to choose between
      const best = chooseMove(GameState.fromSnapshot(room.state.snapshot()), 'hard', () => 0.5);
      clock.advance(CFG.aiPickMs);
      expect(red.conn.last('moved'), `seed ${seed}`).toMatchObject({ player: 'red', auto: true, index: best });
      compared++;
    }
    expect(compared).toBeGreaterThan(15); // enough games had a real choice
  });

  it('keeps counting when something unrelated happens (another person drops, or comes back), so the countdown shown stays true', () => {
    const { room, clock, red, green } = twoPeople(rngFor(6));
    clock.advance(10_000);
    room.disconnect(green.token, green.conn); // green's connection drops while red is being waited for
    clock.advance(4_999);
    expect(red.conn.of('rolled')).toHaveLength(0);
    clock.advance(1); // 15 s after red's turn began, not 15 s after green dropped
    expect(red.conn.last('rolled')).toMatchObject({ player: 'red', auto: true });
  });

  it('tells a screen that joins or resyncs mid-wait how much time is left', () => {
    const { room, clock, red, green } = twoPeople(rngFor(6));
    clock.advance(6_000);
    room.handle(green.token, { t: 'sync' });
    expect(green.conn.last('snapshot').timeoutMs).toBe(9_000);

    room.disconnect(green.token, green.conn);
    clock.advance(2_000);
    const back = new FakeConn();
    room.rejoin(back, green.token);
    expect(back.last('snapshot').timeoutMs).toBe(7_000); // red's countdown did not restart because green came back
    expect(red.conn.last('turn')).toBeUndefined();
  });

  it('starts a new countdown after a person is back from being away (their turn started again)', () => {
    const { room, clock, red } = twoPeople(rngFor(3));
    room.disconnect(red.token, red.conn); // red is the one being waited for, and drops
    const back = new FakeConn();
    clock.advance(1_000);
    room.rejoin(back, red.token);
    expect(back.last('snapshot').timeoutMs).toBe(15_000);
  });

  it('is not sent in a snapshot when a computer is up or the game is over', () => {
    const { room, clock } = setup({ rng: rngFor(3) });
    const [host] = people(room, 1);
    room.handle(host.token, { t: 'addAi' });
    room.handle(host.token, { t: 'start' });
    ROLL(room, host); // the turn passes to the computer
    room.handle(host.token, { t: 'sync' });
    expect(host.conn.last('snapshot').timeoutMs).toBeUndefined();
    expect(clock.pending).toBeGreaterThan(0);
  });
});

describe('losing the connection counts as leaving the game', () => {
  const started = (count = 3, rng = seeded(5)) => {
    const { room, clock } = setup({ rng });
    const who = people(room, count);
    room.handle(who[0].token, { t: 'start' });
    return { room, clock, who };
  };
  const seatOf = (p, color) => p.conn.last('room').room.seats.find((s) => s.color === color);

  it('takes the player out completely once they have been offline for 10 seconds: nobody plays their seat, and the others are told', () => {
    const { room, clock, who } = started();
    room.disconnect(who[1].token, who[1].conn);
    clock.advance(CFG.disconnectLeaveMs - 1);
    expect(room.members.has(who[1].token)).toBe(true); // a short outage costs nothing
    clock.advance(1);
    expect(room.members.has(who[1].token)).toBe(false);
    expect(seatOf(who[0], 'green')).toMatchObject({ kind: 'left', status: 'left', connected: false });
    expect(seatOf(who[2], 'green').kind).toBe('left');
    expect(room.ais.size).toBe(0); // the computer does NOT take the seat
    expect(who[0].conn.last('left')).toMatchObject({ player: 'green', over: false });
    expect(room.state.statusOf('green')).toBe('left');
    expect(room.state.tokens.green).toEqual([-1, -1, -1, -1]);
  });

  it('does not play for them while they are away or after they left: no roll or move is ever made for their seat', () => {
    const { room, clock, who } = started(3, seeded(11));
    room.disconnect(who[1].token, who[1].conn);
    for (let i = 0; i < 4000 && room.phase === 'playing'; i++) {
      for (const p of [who[0], who[2]]) if (room.state.phase === 'roll' && room.state.currentPlayer === p.conn.last('joined').color) ROLL(room, p);
      clock.advance(500);
    }
    const events = who[0].conn.sent.filter((m) => (m.t === 'rolled' || m.t === 'moved') && m.player === 'green');
    expect(events).toEqual([]);
  });

  it('passes the turn on when it was their turn, with a numbered "left" event followed by the "turn"', () => {
    const { room, clock, who } = started();
    expect(room.state.currentPlayer).toBe('red');
    room.leave(who[0].token); // red (whose turn it is) leaves; the host passes to the next person
    const types = who[2].conn.sent.slice(-4).map((m) => m.t);
    const left = who[2].conn.last('left');
    const turn = who[2].conn.last('turn');
    expect(left).toMatchObject({ player: 'red', over: false });
    expect(turn).toMatchObject({ player: 'green', extra: false });
    expect(turn.seq).toBe(left.seq + 1);
    expect(types).toContain('left');
    expect(room.state.currentPlayer).toBe('green');
    clock.advance(1);
  });

  it('gives a player who is left alone the win: rankings are the one still in, then those who left (the last to leave first)', () => {
    const { room, who } = started(3);
    room.leave(who[1].token); // green leaves
    room.leave(who[0].token); // red leaves: yellow is alone
    expect(room.phase).toBe('over');
    const left = who[2].conn.last('left');
    expect(left).toMatchObject({ player: 'red', over: true, winner: 'yellow', rankings: ['yellow', 'red', 'green'] });
    expect(room.state.winner).toBe('yellow');
  });

  it('refuses them if they come back after that: their seat is gone', () => {
    const { room, clock, who } = started();
    room.disconnect(who[1].token, who[1].conn);
    clock.advance(CFG.disconnectLeaveMs + 100);
    const back = new FakeConn();
    expect(room.rejoin(back, who[1].token).error.code).toBe('bad_token');
  });

  it('lets them back, in their own seat, when they return in time (and the timer is cancelled)', () => {
    const { room, clock, who } = started();
    room.disconnect(who[1].token, who[1].conn);
    clock.advance(CFG.disconnectLeaveMs - 1000);
    const back = new FakeConn();
    expect(room.rejoin(back, who[1].token).token).toBe(who[1].token);
    clock.advance(CFG.disconnectLeaveMs * 3);
    expect(room.members.has(who[1].token)).toBe(true);
    expect(room.state.statusOf('green')).toBe('playing');
  });

  it('does not make everybody leave when everybody is offline together (that is the connection to the server, not them)', () => {
    const { room, clock, who } = started();
    for (const p of who) room.disconnect(p.token, p.conn);
    clock.advance(CFG.disconnectLeaveMs * 4);
    expect(room.members.size).toBe(3);
  });

  it('keeps the game going for the others to the end, never giving the one who left a turn', () => {
    const { room, clock, who } = started(3, seeded(21));
    room.leave(who[1].token);
    const colors = who.map((p) => p.conn.last('joined').color);
    for (let i = 0; i < 100000 && room.phase === 'playing'; i++) {
      for (const [k, p] of who.entries()) if (k !== 1 && room.state.phase === 'roll' && room.state.currentPlayer === colors[k] && room.members.has(p.token)) ROLL(room, p);
      clock.advance(1000);
    }
    expect(room.phase).toBe('over');
    const turns = who[0].conn.sent.filter((m) => m.t === 'turn' || m.t === 'rolled').map((m) => m.player);
    expect(turns.length).toBeGreaterThan(10);
    expect(turns).not.toContain('green');
    expect(room.state.rankings).toHaveLength(3);
    expect(room.state.rankings.at(-1)).toBe('green'); // the one who left is last
  });

  it('can be switched off (disconnectLeaveMs null): the seat is kept as before', () => {
    const { room, clock } = setup({ rng: seeded(5), config: { disconnectLeaveMs: null } });
    const who = people(room, 2);
    room.handle(who[0].token, { t: 'start' });
    room.disconnect(who[1].token, who[1].conn);
    clock.advance(CFG.disconnectLeaveMs * 10);
    expect(room.members.has(who[1].token)).toBe(true);
  });
});
