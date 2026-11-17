// Player names: how they are made up, and which ones are allowed. Shared by the game (the profile screen) and the server
// (which checks every name it is sent), so both agree. A name is only a label to show: it never identifies anybody (two
// people may have the same one); the server identifies people by their own ids (see server/Room.js).

export const NAME_MIN = 3;
export const NAME_MAX = 16;
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

const PREFIXES = ['Player', 'User', 'LudoPlayer'];

// A random name such as Player482 or LudoPlayer156 (always valid, at most 13 characters).
export function randomName(rng = Math.random) {
  const prefix = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const number = 100 + Math.floor(rng() * 900);
  return `${prefix}${number}`;
}

// Word stems that are not allowed anywhere in a name. The name is compared in lower case, with look-alike digits turned
// back into letters and underscores removed, so "B4d_W0rd" is caught like "badword". This is a basic filter, not a
// complete one: a game with public chat or names would also need reporting.
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'slut', 'nazi', 'hitler', 'nigg', 'fagg', 'asshole', 'bastard', 'penis', 'vagina', 'admin', 'moderator'];
const LOOK_ALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
const plain = (name) => name.toLowerCase().replace(/_/g, '').replace(/[0134578]/g, (ch) => LOOK_ALIKES[ch] ?? ch);

// Checks what a person typed. Returns { ok: true, name } with the cleaned name (leading and trailing spaces removed), or
// { ok: false, error } with a message that can be shown as it is.
export function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a name.' };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: 'Enter a name.' };
  if (name.length < NAME_MIN) return { ok: false, error: `Use at least ${NAME_MIN} characters.` };
  if (name.length > NAME_MAX) return { ok: false, error: `Use at most ${NAME_MAX} characters.` };
  if (!NAME_PATTERN.test(name)) return { ok: false, error: 'Use only letters, numbers and _ (no spaces).' };
  const flat = plain(name);
  if (BLOCKED.some((word) => flat.includes(word))) return { ok: false, error: 'Please choose a different name.' };
  return { ok: true, name };
}
