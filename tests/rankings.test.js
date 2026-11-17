import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, Room } from '../server/Room.js';
import { PHASE } from '../src/game/GameState.js';
import { medalColor, ordinal } from '../src/ui/ranking.js';
import { FakeClock, FakeConn } from './fakes.js';
import { rngFor, seeded } from './helpers.js';

const CFG = DEFAULT_CONFIG;
const HOME = () => [56, 56, 56, 55]; // one roll of 1 from finishing

// A started 4-player room of four people (red, green, yellow, blue) where every die roll is `roll`.
function game({ roll = 1, rng = rngFor(roll), people = 4 } = {}) {
  const clock = new FakeClock();
  let n = 0;
  const room = new Room({ code: 'BCDF', seats: 4, clock, rng, makeToken: () => `token-${++n}-`.padEnd(24, 'x') });
  const who = Array.from({ length: people }, () => {
    const conn = new FakeConn();
    const { token } = room.join(conn);
    return { conn, token };
  });
  for (let i = people; i < 4; i++) room.handle(who[0].token, { t: 'addAi' });
  room.handle(who[0].token, { t: 'start' });
  const [red, green, yellow, blue] = who;
  return { room, clock, red, green, yellow, blue, who };
}
const rollAndMove = (room, p, index = 3) => {
  room.handle(p.token, { t: 'roll' });
  room.handle(p.token, { t: 'move', index });
};
const err = (p) => p.conn.last('error')?.code;

describe('the server hands out the finishing positions', () => {
  it('gives the first finisher 1st place, tells everybody, and keeps the game going', () => {
    const { room, red, green, who } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    for (const p of who) {
      const moved = p.conn.last('moved');
      expect(moved).toMatchObject({ player: 'red', position: 1, winner: 'red', rankings: ['red'] });
    }
    expect(room.phase).toBe('playing'); // not over
    expect(room.state.phase).not.toBe(PHASE.GAME_OVER);
    const seats = green.conn.last('room').room.seats;
    expect(seats.find((s) => s.color === 'red')).toMatchObject({ status: 'finished', position: 1 });
    expect(seats.find((s) => s.color === 'green')).toMatchObject({ status: 'playing', position: null });
    expect(room.state.currentPlayer).toBe('green'); // a finish gives no bonus turn to the one who is out
    expect(green.conn.last('turn')).toMatchObject({ player: 'green' });
  });

  it('does not touch the other players\' tokens or reset the board', () => {
    const { room, red } = game();
    room.state.tokens.green = [3, 20, -1, 56];
    room.state.tokens.blue = [40, 41, 42, 43];
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    expect(room.state.tokens.green).toEqual([3, 20, -1, 56]);
    expect(room.state.tokens.blue).toEqual([40, 41, 42, 43]);
  });

  it('never gives a finished player another turn, over many rounds', () => {
    let first = true; // red's first roll is a 1 (so it finishes at once); the rest are random
    const random = seeded(3);
    const { room, clock, red, who } = game({ rng: () => (first ? ((first = false), rngFor(1)()) : random()) });
    room.state.tokens.red = HOME();
    // red finishes first; then computers (everybody times out) play on and the turn events never name red
    rollAndMove(room, red);
    const since = who[1].conn.sent.length;
    for (let i = 0; i < 400 && room.phase === 'playing'; i++) clock.advance(500);
    const turns = who[1].conn.sent.slice(since).filter((m) => m.t === 'turn' || m.t === 'rolled').map((m) => m.player);
    expect(turns.length).toBeGreaterThan(20);
    expect(turns).not.toContain('red');
  });

  it('refuses rolls and moves from a player who has finished', () => {
    const { room, red } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.handle(red.token, { t: 'roll' });
    expect(err(red)).toBe('not_your_turn');
    room.handle(red.token, { t: 'move', index: 0 });
    expect(err(red)).toBe('not_your_turn');
  });

  it('gives 2nd and 3rd place in the order they finish, then 4th to the last player left, and ends the game', () => {
    const { room, red, green, yellow, blue, who } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.state.tokens.green = HOME();
    expect(room.state.currentPlayer).toBe('green');
    rollAndMove(room, green);
    expect(green.conn.last('moved')).toMatchObject({ position: 2, rankings: ['red', 'green'] });
    expect(room.phase).toBe('playing');
    room.state.tokens.yellow = HOME();
    expect(room.state.currentPlayer).toBe('yellow');
    rollAndMove(room, yellow);
    const last = blue.conn.last('moved');
    expect(last).toMatchObject({ player: 'yellow', position: 3, winner: 'red', rankings: ['red', 'green', 'yellow', 'blue'] });
    expect(room.phase).toBe('over');
    const seats = who[0].conn.last('room').room.seats;
    expect(seats.map((s) => [s.color, s.position, s.status])).toEqual([['red', 1, 'finished'], ['green', 2, 'finished'], ['yellow', 3, 'finished'], ['blue', 4, 'finished']]);
    room.handle(blue.token, { t: 'roll' });
    expect(err(blue)).toBe('bad_phase');
  });

  it('does not send a second winner event: each position is announced once', () => {
    const { room, red, green, who } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.state.tokens.green = HOME();
    rollAndMove(room, green);
    for (const p of who) {
      const positions = p.conn.sent.filter((m) => m.t === 'moved' && m.position).map((m) => m.position);
      expect(positions).toEqual([1, 2]);
    }
  });

  it('keeps the dice rules for the others: a roll of 6 still gives an extra turn', () => {
    const { room, red, green } = game({ roll: 6 });
    room.state.tokens.red = [56, 56, 56, 50]; // a 6 finishes it
    rollAndMove(room, red);
    expect(red.conn.last('moved').position).toBe(1);
    expect(room.state.currentPlayer).toBe('green'); // no extra roll for the one who finished...
    room.handle(green.token, { t: 'roll' });
    room.handle(green.token, { t: 'move', index: 0 }); // ...but green brings a token out with a 6 and
    expect(room.state.currentPlayer).toBe('green'); // gets the usual extra roll
    expect(green.conn.last('turn')).toMatchObject({ player: 'green', extra: true });
  });
});

describe('finished players and connections', () => {
  it('goes on when a player who has finished disconnects, and does not wait for them', () => {
    const { room, clock, red, green } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.disconnect(red.token, red.conn);
    expect(room.phase).toBe('playing');
    rollAndMove(room, green, 0); // green rolls (a 1: nothing in the yard moves); the turn passes
    expect(room.state.currentPlayer).toBe('yellow');
    // nobody ever waits for red: the next turns go yellow, blue, green
    clock.advance(CFG.turnTimeoutMs + 100);
    expect(room.state.currentPlayer).not.toBe('red');
  });

  it('gives a player who comes back the rankings so far, and their own finish stays', () => {
    const { room, red } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.disconnect(red.token, red.conn);
    const back = new FakeConn();
    room.rejoin(back, red.token);
    expect(back.last('snapshot').snapshot.rankings).toEqual(['red']);
    expect(back.last('snapshot').snapshot.winner).toBe('red');
    const mine = back.last('room').room.seats.find((s) => s.color === 'red');
    expect(mine).toMatchObject({ status: 'finished', position: 1, connected: true });
  });

  it('lets a player leave after finishing: the computer holds the seat, which never gets a turn', () => {
    const { room, red } = game();
    room.state.tokens.red = HOME();
    rollAndMove(room, red);
    room.leave(red.token);
    expect(room.state.rankings).toEqual(['red']);
    expect(room.state.currentPlayer).not.toBe('red');
  });

  it('puts the whole ranking in the snapshot of a game that is over', () => {
    const { room, red, green, yellow, who } = game();
    for (const [p, c] of [[red, 'red'], [green, 'green'], [yellow, 'yellow']]) {
      room.state.tokens[c] = HOME();
      rollAndMove(room, p);
    }
    room.handle(who[0].token, { t: 'sync' });
    expect(who[0].conn.last('snapshot').snapshot.rankings).toEqual(['red', 'green', 'yellow', 'blue']);
    const back = new FakeConn();
    room.rejoin(back, who[3].token);
    expect(back.last('snapshot').snapshot.rankings).toEqual(['red', 'green', 'yellow', 'blue']);
  });

  it('plays a whole four-computer game to the end with every position handed out once', () => {
    const { room, clock, who } = game({ rng: seeded(21), people: 1 });
    for (let i = 0; i < 80000 && room.phase === 'playing'; i++) clock.advance(1000);
    expect(room.phase).toBe('over');
    const moved = who[0].conn.sent.filter((m) => m.t === 'moved' && m.position);
    expect(moved.map((m) => m.position)).toEqual([1, 2, 3]); // the 4th place needs no move of its own
    expect(new Set(who[0].conn.last('moved').rankings).size).toBe(4);
  });
});

describe('ranking words and colours', () => {
  it('says 1st, 2nd, 3rd and 4th', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });

  it('has a medal colour for each position, all different', () => {
    expect(new Set([1, 2, 3, 4].map(medalColor)).size).toBe(4);
  });
});
