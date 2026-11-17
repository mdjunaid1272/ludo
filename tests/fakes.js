// A fake clock for tests: time only moves when advance() is called, and timers fire in order.
export class FakeClock {
  constructor() {
    this.t = 0;
    this.timers = [];
    this.next = 0;
  }

  now() {
    return this.t;
  }

  setTimeout(fn, ms) {
    const id = ++this.next;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }

  clearTimeout(id) {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  }

  // Moves time forward, running every timer that falls due (including ones scheduled by timers).
  advance(ms) {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = target;
  }

  get pending() {
    return this.timers.length;
  }
}

// A fake client connection: records everything the server sends it.
export class FakeConn {
  constructor() {
    this.sent = [];
  }

  send(message) {
    this.sent.push(JSON.parse(JSON.stringify(message))); // what would arrive over the wire
  }

  of(type) {
    return this.sent.filter((m) => m.t === type);
  }

  last(type) {
    return this.of(type).at(-1);
  }

  clear() {
    this.sent.length = 0;
  }
}
