// Works out which WebSocket address the game should connect to.
//
//   - ?server=ws://host:port/ws in the page address (or a saved override) wins, so a build can be pointed at any server.
//   - When the page is served by the Vite dev/preview server (ports 5173/4173) the game server is assumed to be
//     on the same machine at port 8080 (`npm run server`).
//   - Otherwise the page was served by the game server itself, so connect back to the same host and port.

const DEV_PORTS = new Set(['5173', '4173']);
export const DEV_SERVER_PORT = 8080;

export const isValidServerUrl = (value) => {
  if (typeof value !== 'string' || value.length > 200) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && url.hostname.length > 0;
  } catch {
    return false;
  }
};

// `loc` is like window.location: { protocol, hostname, port, search }.
export function resolveServerUrl(loc, stored = null) {
  const fromQuery = new URLSearchParams(loc.search ?? '').get('server');
  for (const candidate of [fromQuery, stored]) {
    if (candidate && isValidServerUrl(candidate)) return candidate;
  }
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  const host = loc.hostname || 'localhost';
  if (DEV_PORTS.has(String(loc.port))) return `${scheme}://${host}:${DEV_SERVER_PORT}/ws`;
  return `${scheme}://${host}${loc.port ? `:${loc.port}` : ''}/ws`;
}
