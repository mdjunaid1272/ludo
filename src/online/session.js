import { OnlineSession } from './OnlineSession.js';
import { resolveServerUrl } from './serverUrl.js';

// The one online session shared by all screens. The address is worked out when connecting, from the page address
// (see serverUrl.js).
export const onlineSession = new OnlineSession({ getUrl: () => resolveServerUrl(window.location, window.LUDO_SERVER || null) });

// A phone that was asleep or lost Wi-Fi may have a dead connection it does not know about: check it as soon as the
// page is visible again or the network comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onlineSession.refreshConnection();
  });
  window.addEventListener('online', () => onlineSession.refreshConnection());
  window.addEventListener('offline', () => onlineSession.connectionLost());
}