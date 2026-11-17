# Deploying the online game

Online play needs **three** things to line up. If "Could not connect" appears, one of them is missing; `npm run check:online` tells you which.

1. **The Node game server is running** (`node server/start.js`, kept alive by pm2).
2. **The proxy forwards `/ws` to it with the WebSocket upgrade headers** (`deploy/nginx.conf.example`).
3. **Cloudflare lets WebSockets through** (below), and the page points at the right address (`config.js`).

## On the server

```
unzip ludo-server-YYYYMMDD.zip -d /srv/ludo && cd /srv/ludo
npm install --omit=dev            # Node 20 or newer
npm install -g pm2
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup     # starts again after a reboot
curl http://127.0.0.1:8080/health                                    # {"ok":true,"connections":0,"rooms":0}
npm run check:online -- http://127.0.0.1:8080                       # the WebSocket works locally
```

Restart after an update: `pm2 restart ludo`. Stop: `pm2 stop ludo`. Logs: `pm2 logs ludo`. The server shuts down cleanly on SIGTERM.

## Environment variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | port the game server listens on | 8080 |
| `HOST` | address it listens on (`127.0.0.1` behind a proxy) | 0.0.0.0 |
| `STATIC_DIR` | folder with the built game | dist |
| `TRUST_PROXY` | `1` behind nginx / Cloudflare: use the address the proxy reports for the per-address limit | off |
| `MAX_CONNECTIONS_PER_IP` | connections one address may keep open | 20 |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to open WebSockets, e.g. `https://gametest2.atmegame.com` | any |
| `LOG_LEVEL` | `debug` also logs accepted WebSocket connections (refused ones are always logged with the reason) | quiet |

Without `TRUST_PROXY=1`, behind a proxy every player looks like the same address and the 21st connection is refused with 429.

## nginx

Use `deploy/nginx.conf.example`. The part that matters: `proxy_http_version 1.1;` and the `Upgrade` / `Connection` headers on `location /ws`. Test with `nginx -t`, then `systemctl reload nginx`.

## Cloudflare (if the domain is proxied by Cloudflare)

- **Network → WebSockets: On** (on by default, but check it).
- Security → Events: look for blocked requests to `/ws` (rule name and action). If a managed rule or bot rule blocks it, add a **narrow** skip rule for the URI path `/ws` on this hostname only; do not turn protections off for the zone.
- Cloudflare only proxies certain ports (443, 8443, ...). Point the page at `wss://your-domain/ws` (port 443) and let nginx forward to 8080 internally; do not expose 8080.
- If the game and server are on different hostnames, set `window.LUDO_SERVER = 'wss://server-host/ws'` in `config.js` and put that hostname in `ALLOWED_ORIGINS` if you use it.

## The page

`config.js` (next to `index.html`): leave `window.LUDO_SERVER = ''` when `/ws` is on the same domain as the page; otherwise set the full `wss://.../ws` address. A page opened over `https://` can only use `wss://`.

## Diagnosing "Could not connect"

`npm run check:online -- https://your-domain` makes a real WebSocket attempt and names the cause:

| What it reports | Meaning |
| --- | --- |
| `101` / "WebSocket works" | the whole chain works |
| 502 / 503 / 504 | proxy is fine, the Node game server is not running or on another port |
| 404 | no `/ws` route in the proxy |
| 200 / 301 (a web page) | the proxy does not forward the upgrade (missing headers or HTTP/1.1) |
| 403 from `cloudflare` | Cloudflare blocks it (WebSockets setting, WAF or bot rule). Note: Cloudflare may answer 403 to this tool for every path, in which case use the browser's Network tab instead |
| 429 | per-address limit: set `TRUST_PROXY=1` |
| connection refused | nothing is listening there |

In the browser: DevTools → Network → WS → click `/ws` → Headers shows the real status code.

## "Unexpected response code: 403" during the WebSocket handshake

A 403 can come from three places. Telling them apart takes one command, run from your own computer or the server:

```
npm run check:online -- https://your-domain
```

| What it shows | Who sent the 403 | Fix |
| --- | --- | --- |
| `The game server itself refused it ... not in ALLOWED_ORIGINS` (and a response header `X-Ludo-Reject`) | the Node game server | `ALLOWED_ORIGINS` must contain the page's origin exactly as browsers send it: `https://gametest2.atmegame.com` (scheme + host, no path). Capitals and a trailing `/` are now tolerated. Set it, or remove the variable to allow any origin, then `pm2 restart ludo --update-env` |
| a Cloudflare HTML page / `server: cloudflare`, no `X-Ludo-Reject` | Cloudflare (WAF, bot rule, "WebSockets" off) | Network > WebSockets = On; Security > Events shows the rule that blocked `/ws`; add a narrow skip rule for URI path `/ws` on this hostname |
| nginx's own 403 page (`server: nginx`, no `X-Ludo-Reject`) | nginx | a `deny`, geo or `valid_referers` rule, or the `/ws` location sends the request to a folder instead of the Node server |

The game server only ever sends one kind of 403: the origin check in `server/index.js` (`checkOrigin`). Everything else is a 404 (wrong path, with the hint "use /ws"), 429 (too many connections from one address) or 503. Every refused upgrade is logged with the path, Origin, Host, address and the exact reason (never cookies or tokens): `pm2 logs ludo`. Set `LOG_LEVEL=debug` to log accepted connections too.

In the browser the refusal reason is in the response header `X-Ludo-Reject` of the `/ws` request when the game server sent it.