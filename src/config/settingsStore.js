import { normalizeSettings } from '../game/settings.js';

// Bump the version when a default changes, so saved settings (which contain every rule) do not keep the old default.
const KEY = 'ludo.settings.v2';

// Saves settings in localStorage. Storage can be missing, blocked or full (private windows,
// sandboxed frames), so every access is guarded and the game always works without it.
export function createSettingsStore(getStorage = () => globalThis.localStorage) {
  return {
    load() {
      try {
        const text = getStorage()?.getItem(KEY);
        return normalizeSettings(text ? JSON.parse(text) : null);
      } catch {
        return normalizeSettings(null);
      }
    },
    save(settings) {
      try {
        const storage = getStorage();
        if (!storage) return false;
        storage.setItem(KEY, JSON.stringify(normalizeSettings(settings)));
        return true;
      } catch {
        return false;
      }
    },
    reset() {
      try {
        getStorage()?.removeItem(KEY);
      } catch {
        // nothing to clear
      }
      return normalizeSettings(null);
    },
  };
}

export const settingsStore = createSettingsStore();

