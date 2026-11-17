// A thin wrapper around one WebSocket connection to the game server. It sends and receives JSON messages,
// reports closes, and sends a ping now and then so idle connections are not dropped by proxies. It does not
// reconnect by itself: OnlineSession decides when to connect again. The WebSocket class and the timers can be
// replaced, which is how it is unit tested without a network.
export class OnlineClient {
  #socket = null;
  #pingTimer = null;

  // A connection that has not heard anything from the server (the server answers every ping) for `deadAfterMs` is treated as lost,
  // for example when the Wi-Fi was switched off: a closed socket is not always reported by the browser for a long time.
  constructor({ WebSocketImpl = globalThis.WebSocket, timers = globalThis, connectTimeoutMs = 8000, pingMs = 5000, deadAfterMs = pingMs * 2.5, now = () => Date.now() } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.timers = timers;
    this.connectTimeoutMs = connectTimeoutMs;
    this.pingMs = pingMs;
    this.deadAfterMs = deadAfterMs;
    this.now = now;
    this.lastHeardAt = 0;
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  get connected() {
    return this.#socket !== null && this.#socket.readyState === 1;
  }

  // Opens the connection. Resolves when it is open; rejects if it fails or takes too long.
  connect(url) {
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timeout = this.timers.setTimeout(() => fail(new Error('Connection timed out')), this.connectTimeoutMs);
      const finish = () => {
        settled = true;
        this.timers.clearTimeout(timeout);
      };
      const fail = (error) => {
        if (settled) return;
        finish();
        try {
          socket?.close();
        } catch {
          // already closed
        }
        if (this.#socket === socket) this.#socket = null;
        reject(error);
      };

      try {
        socket = new this.WebSocketImpl(url);
      } catch (error) {
        fail(error);
        return;
      }
      this.#socket = socket;

      socket.onopen = () => {
        if (settled) return;
        finish();
        this.#startPing();
        resolve();
      };
      socket.onmessage = (event) => {
        this.lastHeardAt = this.now();
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return; // not ours: ignore
        }
        if (message && typeof message.t === 'string') this.onMessage(message);
      };
      socket.onerror = () => fail(new Error('Could not connect to the server'));
      socket.onclose = (event) => {
        const wasCurrent = this.#socket === socket;
        if (wasCurrent) this.#socket = null;
        this.#stopPing();
        fail(new Error('Connection closed'));
        if (wasCurrent) this.onClose({ code: event?.code ?? 0, reason: event?.reason ?? '' });
      };
    });
  }

  // Returns false (and sends nothing) if the connection is not open.
  send(message) {
    if (!this.connected) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  // Treats the connection as lost (for example it stopped answering after the phone slept): closes it and
  // reports an unexpected close, so the session reconnects.
  drop() {
    const socket = this.#socket;
    if (!socket) return;
    this.close();
    this.onClose({ code: 0, reason: 'dropped' });
  }

  // Closes the connection on purpose; onClose is not called for this.
  close() {
    const socket = this.#socket;
    this.#socket = null;
    this.#stopPing();
    if (!socket) return;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  #startPing() {
    this.#stopPing();
    this.lastHeardAt = this.now();
    this.#pingTimer = this.timers.setInterval(() => {
      if (this.now() - this.lastHeardAt > this.deadAfterMs) this.drop(); // silent for too long: lost (the session reconnects)
      else this.send({ t: 'ping' });
    }, this.pingMs);
  }

  #stopPing() {
    if (this.#pingTimer !== null) this.timers.clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }
}
