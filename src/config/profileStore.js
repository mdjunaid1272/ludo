import { randomName, validateName } from '../game/playerName.js';

// The player's profile (for now only the name), kept in localStorage under its own key: it is the person's own label for
// themselves, separate from the settings and from anything the online server knows. The server gives people their ids; this
// name is only sent along when joining, to be shown to the others.
const KEY = 'ludo.profile.v1';

// Storage can be missing, blocked or full (private windows, sandboxed frames), so every access is guarded. Without
// storage the name still stays the same for as long as the page is open (it is generated once and remembered here).
export function createProfileStore(getStorage = () => globalThis.localStorage, rng = Math.random) {
  let cached = null;

  const read = () => {
    try {
      const text = getStorage()?.getItem(KEY);
      const saved = text ? JSON.parse(text)?.name : null;
      const checked = validateName(saved);
      return checked.ok ? checked.name : null;
    } catch {
      return null;
    }
  };
  const write = (name) => {
    try {
      const storage = getStorage();
      if (!storage) return false;
      storage.setItem(KEY, JSON.stringify({ name }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    // The saved name. The first time (or when nothing valid is saved) a random one is made up and saved, so it is chosen
    // only once and a custom name is never replaced.
    name() {
      const saved = read();
      if (saved) return (cached = saved);
      if (cached) {
        write(cached); // storage was empty or has just come back: keep the name this page has been using
        return cached;
      }
      cached = randomName(rng);
      write(cached);
      return cached;
    },
    // Saves a name the person typed, if it is allowed. Returns the validation result ({ ok, name } or { ok, error }).
    setName(raw) {
      const result = validateName(raw);
      if (!result.ok) return result;
      cached = result.name;
      write(result.name);
      return result;
    },
  };
}

export const profileStore = createProfileStore();
