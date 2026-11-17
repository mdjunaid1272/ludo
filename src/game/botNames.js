// Names for the computer players: ordinary-looking usernames, so a bot sits at the table like any other player. Every name
// is a valid player name (3-16 letters, numbers, underscores; see playerName.js).
export const BOT_NAMES = [
  'Aarav_07', 'RohanK', 'Priya_2001', 'Vikram99', 'Ananya_S', 'Kabir_Singh', 'Meera_14', 'Arjun_R', 'Diya_Sharma', 'Ishaan_X',
  'Neha_Patel', 'Rahul_1995', 'Sneha_M', 'Aditya_V', 'Pooja_22', 'Karan_J', 'Tanvi_08', 'Dev_Anand', 'Riya_Gupta', 'Yash_Raj',
  'Sana_Khan', 'Omkar_P', 'Kavya_N', 'Harsh_77', 'Zoya_A', 'Nikhil_D', 'Isha_Rao', 'Varun_B', 'Simran_K', 'Manav_03',
  'Lucky_Dice', 'King_Rohit', 'Ludo_Pro', 'Sam_Carter', 'Emma_W', 'Liam_Cole', 'Mia_Rose', 'Noah_B', 'Zara_Lee', 'Leo_Park',
];

// A small, well mixed number from a text (FNV-1a).
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A bot name that depends only on `key` (so it stays the same for the same game and seat), different from every name in
// `taken` (compared without regard to capitals).
export function botName(key, taken = []) {
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  const start = hash(key) % BOT_NAMES.length;
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const name = BOT_NAMES[(start + i) % BOT_NAMES.length];
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Bot_${hash(key) % 1000}`;
}
