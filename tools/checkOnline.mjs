// Diagnoses a Ludo game server from the outside:  npm run check:online -- https://gametest2.atmegame.com
// (or a ws:// / wss:// address). It checks /health over HTTP(S), then opens a real WebSocket at /ws and says what happened,
// including the HTTP status and server name when the handshake is refused, which is what tells a stopped game server (502/504),
// a missing proxy route (404), a Cloudflare / firewall block (403 from "cloudflare") and a missing upgrade (200 HTML) apart.
import WebSocket from 'ws';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run check:online -- https://your-domain   (or wss://your-domain/ws)');
  process.exit(2);
}
const base = new URL(arg.replace(/^ws/, 'http'));
const wsUrl = new URL('/ws', base);
wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const healthUrl = new URL('/health', base);

const verdict = (lines) => console.log(`\n=> ${lines}`);

console.log(`1. GET ${healthUrl}`);
let healthOk = false;
let healthStatus = null;

try {
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  healthStatus = res.status;
  console.log(`   status ${res.status}, server: ${res.headers.get('server') ?? '?'}, type: ${res.headers.get('content-type') ?? '?'}`);
  try {
    const body = JSON.parse(text);
    healthOk = body.ok === true;
    console.log(`   game server answered: ${text}`);
  } catch {
    console.log('   this is not the game server\'s answer (no JSON like {"ok":true,...})');
  }
} catch (error) {
  console.log(`   failed: ${error.cause?.code ?? error.message}`);
}

console.log(`2. WebSocket ${wsUrl}`);
const outcome = await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl, { headers: { Origin: base.origin }, handshakeTimeout: 15000 });
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'ping' }));
    const timer = setTimeout(() => { ws.close(); resolve({ kind: 'open-silent' }); }, 5000);
    ws.on('message', (data) => { clearTimeout(timer); ws.close(); resolve({ kind: 'open', reply: data.toString() }); });
  });
  ws.on('unexpected-response', (_req, res) => { resolve({ kind: 'refused', status: res.statusCode, server: res.headers.server, type: res.headers['content-type'], ludoReject: res.headers['x-ludo-reject'] }); res.destroy(); });
  ws.on('error', (error) => resolve({ kind: 'error', message: error.code ?? error.message }));
});
console.log(`   ${JSON.stringify(outcome)}`);

if (outcome.kind === 'open') verdict('WebSocket works: the game server answered. If the game still cannot connect, check window.LUDO_SERVER in config.js (it must be empty or this address).');
else if (outcome.kind === 'open-silent') verdict('The WebSocket opened but nothing answered: something accepts WebSockets here, but it is not the Ludo server.');
else if (outcome.kind === 'refused') {
  const s = outcome.status;
  const cf = /cloudflare/i.test(outcome.server ?? '');
  if (outcome.ludoReject) verdict(`The game server itself refused it (HTTP ${s}): ${outcome.ludoReject}. ${s === 403 ? 'Fix ALLOWED_ORIGINS on the game server: it must list the origin of the page (https://your-domain, no path), or be removed.' : ''}`);
  else if (s === 403 && cf && healthStatus === 403 && !healthOk) verdict('Cloudflare answers 403 to every request from this computer, /health included, so this tool cannot see past it (a bot or WAF rule for non-browser clients). It does not show whether /ws works for browsers. Run this tool on the server itself (npm run check:online -- http://127.0.0.1:8080) to test the game server, and look at the browser Network tab for the real /ws response.');
  else if (s === 403 && cf) verdict('403 from Cloudflare: Cloudflare (WAF / bot rule / WebSockets setting) is blocking /ws before it reaches your server. Check Cloudflare > Network > WebSockets = On, and Security > Events for a block on /ws.');
  else if (s === 403) verdict('403 from the server or proxy: with ALLOWED_ORIGINS set on the game server, this page\'s origin must be listed; otherwise a proxy/firewall rule rejects /ws.');
  else if (s === 502 || s === 503 || s === 504) verdict(`${s}: the proxy is there but the Node game server behind it is not running or not on the port the proxy forwards to.`);
  else if (s === 404) verdict('404: the proxy or web server has no route for /ws (add the /ws location that forwards to the game server, with the Upgrade headers).');
  else if (s === 200 || s === 301 || s === 302) verdict(`${s}: /ws was answered as an ordinary web page: the proxy is not forwarding the WebSocket upgrade (missing "Upgrade" / "Connection" headers or proxy_http_version 1.1).`);
  else if (s === 429) verdict('429: too many connections from one address; set TRUST_PROXY=1 behind a proxy, or raise MAX_CONNECTIONS_PER_IP.');
  else verdict(`The handshake was refused with HTTP ${s}.`);
} else if (/ENOTFOUND|EAI_AGAIN/.test(outcome.message)) verdict('The domain name does not resolve.');
else if (/ECONNREFUSED/.test(outcome.message)) verdict('Connection refused: nothing is listening on that address and port.');
else if (/CERT|SSL|EPROTO|TLS/i.test(outcome.message)) verdict('TLS problem: the address speaks plain HTTP (use ws://) or the certificate is wrong (wss:// needs a valid certificate).');
else verdict(`The connection failed: ${outcome.message}`);
process.exitCode = outcome.kind === 'open' && healthOk ? 0 : 1;