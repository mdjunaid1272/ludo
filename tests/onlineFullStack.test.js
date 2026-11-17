import { describe, it, expect, vi } from 'vitest';
import { Room, DEFAULT_CONFIG } from '../server/Room.js';
import { OnlineGame } from '../src/online/OnlineGame.js';
import { PHASE } from '../src/game/GameState.js';
import { chooseMove } from '../src/game/ai.js';
import { FakeClock } from './fakes.js';
import { FakeView } from './fakeView.js';
import { seeded } from './helpers.js';

// A complete in-memory online game: the real Room (the server's logic) and a real OnlineGame client for each
// person, connected directly. Everything except the network and the screen is the production code.
class Client {
  constructor(room, { drop = () => false, onError } = {}) {
    this.room = room;
    this.drop = drop;
    this.onError = onError;
    this.view = new FakeView();
    this.game = null;
    this.sent = [];
    this.dropped = 0;
    this.conn = { send: (m) => this.receive(JSON.parse(JSON.stringify(m))) };
  }

  receive(m) {
    switch (m.t) {
      case 'joined':
        this.token = m.token;
        this.color = m.color;
        break;
      case 'started':
      case 'snapshot':
        if (!this.game) this.#createGame(m);
        else this.game.handle(m);
        break;
      case 'rolled':
      case 'moved':
      case 'turn':
        if (this.drop(m)) this.dropped++;
        else this.game?.handle(m);
        break;
      case 'error':
        this.game?.rejected();
        break;
      default:
    }
  }

  #createGame(m) {
    this.game = new OnlineGame({
      snapshot: m.snapshot,
      seq: m.seq,
      myColor: this.color,
      send: (msg) => {
        this.sent.push(msg);
        this.room.handle(this.token, msg);
        return true;
      },
      onError: this.onError,
      onFatal: this.onError,
    });
    this.game.attach(this.view);
  }
}

// Lets promise chains finish (the games only use microtasks because the fake view resolves instantly).
const settle = async (clients) => {
  for (let i = 0; i < 200_000 && clients.some((c) => c.game?.busy); i++) await Promise.resolve();
};

// Plays a whole game. People act when it is their turn (using the AI's choice); otherwise time passes, which
// lets computer seats act and idle people time out.
async function playOut({ seed, humans = 3, ais = 1, rules, drop, mid, config, onError = vi.fn() }) {
  const rng = seeded(seed);
  const clock = new FakeClock();
  const room = new Room({ code: 'BCDF', seats: humans + ais, rules, clock, rng, config });
  const clients = Array.from({ length: humans }, () => new Client(room, { drop: drop?.(), onError }));
  for (const c of clients) room.join(c.conn);
  for (let i = 0; i < ais; i++) room.handle(clients[0].token, { t: 'addAi' });
  room.handle(clients[0].token, { t: 'start' });

  for (let step = 0; step < 30000 && room.phase === 'playing'; step++) {
    await settle(clients);
    if (step % 25 === 0) for (const c of clients) c.game?.checkSeq(room.seq); // the periodic heartbeat
    mid?.(step, { room, clients, clock });
    const actor = clients.find((c) => c.game?.myTurn && !c.game.busy && c.conn);
    if (actor && rng() < 0.7 && actor.game.state.phase === PHASE.ROLL) actor.game.requestRoll();
    else if (actor && rng() < 0.7 && actor.game.state.phase === PHASE.MOVE) actor.game.requestMove(chooseMove(actor.game.state, 'normal', rng));
    else clock.advance(rng() < 0.15 ? DEFAULT_CONFIG.turnTimeoutMs : DEFAULT_CONFIG.aiPickMs + DEFAULT_CONFIG.aiThinkMs);
  }
  await settle(clients);
  for (const c of clients) c.game?.checkSeq(room.seq); // a final heartbeat: reveals events lost at the very end
  await settle(clients);
  await settle(clients);
  return { room, clients, onError };
}

describe('real Room + real OnlineGame clients, connected in memory', () => {
  it('finish complete games with every client ending in exactly the server state, without ever needing a resync', async () => {
    for (const [seed, rules] of [[1, undefined], [2, { blockades: true }], [3, { tripleSix: 'off' }]]) {
      const { room, clients, onError } = await playOut({ seed, rules });
      expect(room.phase, `seed ${seed}`).toBe('over');
      expect(onError).not.toHaveBeenCalled();
      for (const c of clients) {
        expect(c.game.state.snapshot(), `seed ${seed}`).toEqual(room.state.snapshot());
        expect(c.sent.filter((m) => m.t === 'sync'), `seed ${seed}`).toHaveLength(0);
        expect(c.game.seq).toBe(room.seq);
      }
      expect(clients[0].game.state.winner).toBe(room.state.winner);
    }
  });

  it('works with two people only, and with people and computers mixed', async () => {
    for (const [humans, ais] of [[2, 0], [1, 1], [2, 2], [1, 3]]) {
      const { room, clients, onError } = await playOut({ seed: 10 + humans + ais, humans, ais });
      expect(room.phase, `${humans}+${ais}`).toBe('over');
      expect(onError).not.toHaveBeenCalled();
      for (const c of clients) expect(c.game.state.snapshot()).toEqual(room.state.snapshot());
    }
  });

  it('recovers when a client loses a third of the events: it notices, resyncs, and still ends identical to the server', async () => {
    let totalSyncs = 0;
    let totalDropped = 0;
    for (const seed of [21, 22, 23]) {
      const lossy = seeded(seed * 7);
      const { room, clients, onError } = await playOut({ seed, drop: () => () => lossy() < 0.33 });
      expect(room.phase, `seed ${seed}`).toBe('over');
      expect(onError).not.toHaveBeenCalled();
      for (const c of clients) {
        expect(c.game.state.snapshot(), `seed ${seed}`).toEqual(room.state.snapshot());
        totalSyncs += c.sent.filter((m) => m.t === 'sync').length;
        totalDropped += c.dropped;
      }
    }
    expect(totalDropped).toBeGreaterThan(20);
    expect(totalSyncs).toBeGreaterThan(5); // it really did lose events and recover
  }, 120_000); // three whole games to the last position: slow on a busy machine

  it('lets a person drop and rejoin mid-game: the computer fills in, the snapshot catches them up, play continues', async () => {
    let rejoined = null;
    const onError = vi.fn();
    const { room, clients } = await playOut({
      seed: 31,
      onError,
      config: { disconnectLeaveMs: null }, // (the leave rule has its own tests: here the person stays away a long time and still comes back)
      mid: (step, { room: r, clients: cs }) => {
        const victim = cs[1];
        if (step === 40 && !rejoined) {
          r.disconnect(victim.token, victim.conn); // connection drops
          victim.conn = { send: () => {} };
          victim.game.detach();
        }
        if (step === 400 && !rejoined) {
          // a brand-new connection (as after a page reload) rejoins with the saved token
          const fresh = new Client(r, { onError });
          fresh.color = victim.color;
          fresh.token = victim.token;
          r.rejoin(fresh.conn, victim.token);
          cs[1] = fresh;
          rejoined = fresh;
        }
      },
    });
    expect(room.phase).toBe('over');
    expect(onError).not.toHaveBeenCalled();
    expect(rejoined).not.toBeNull();
    expect(rejoined.game).not.toBeNull(); // it was rebuilt from the snapshot the server sent
    for (const c of clients) expect(c.game.state.snapshot()).toEqual(room.state.snapshot());
  });
});
