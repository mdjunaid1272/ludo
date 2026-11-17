// Picking avatars for the players of a game. Pure (no Phaser), so it is easy to test.
//
// Every player of a game gets a different avatar, chosen at random. The choice comes from a seed, so the same seed always
// gives the same avatars: an online room uses its code as the seed, which makes every player's screen show the same
// avatar for the same colour; a game on one device uses a fresh random seed (kept while the screen is rebuilt, for
// example when the phone is rotated, so the avatars do not change in the middle of a game).

// A small, well mixed number from a text (FNV-1a), to start the random numbers from.
function hashSeed(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A tiny seeded random number generator (mulberry32): returns numbers in [0, 1).
function seededRandom(seed) {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newAvatarSeed = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

// { colour: avatar key } for the given players. The keys are sorted first, so the result does not depend on the order the
// pictures were listed in. With more players than avatars the avatars are reused (never the case with four players).
export function assignAvatars(players, seed, keys) {
  const pool = [...keys].sort();
  if (pool.length === 0) return {};
  const random = seededRandom(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Object.fromEntries(players.map((color, i) => [color, pool[i % pool.length]]));
}
