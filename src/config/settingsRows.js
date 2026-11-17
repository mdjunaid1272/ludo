import { LEVELS } from '../game/ai.js';
import { PLAYER_COUNTS, playersFor } from '../game/settings.js';

const onOff = (v) => (v ? 'ON' : 'OFF');

// What the Settings screen shows. Each row edits one value of the settings object.
// `options` are cycled through on click; `write` returns new settings (never mutates).
export const SETTING_ROWS = [
  {
    id: 'players',
    label: 'Players',
    desc: 'Local game (colours: pick on start)',
    options: PLAYER_COUNTS,
    format: (v) => `${v} players`,
    read: (s) => s.players,
    // Changing the count here resets the Local Multiplayer colours to the default set for that count.
    write: (s, v) => ({ ...s, players: v, localColors: playersFor(v) }),
  },
  {
    id: 'difficulty',
    label: 'Computer skill',
    desc: 'How well computer players play',
    options: LEVELS,
    format: (v) => v[0].toUpperCase() + v.slice(1),
    read: (s) => s.difficulty,
    write: (s, v) => ({ ...s, difficulty: v }),
  },
  {
    id: 'tripleSix',
    label: 'Three 6s in a row',
    desc: 'Third 6 loses the turn',
    options: ['forfeit', 'off'],
    format: (v) => (v === 'forfeit' ? 'Lose turn' : 'No limit'),
    read: (s) => s.rules.tripleSix,
    write: (s, v) => ({ ...s, rules: { ...s.rules, tripleSix: v } }),
  },
  ...[
    ['blockades', 'Blockades', 'A pair of tokens blocks others'],
    ['sixGrantsExtra', 'Extra roll on 6', 'Roll again after a 6'],
    ['sixWithoutMoveGrantsExtra', 'Extra on stuck 6', 'Even if no move is possible'],
    ['captureGrantsExtra', 'Extra on capture', 'After sending a token home'],
    ['finishGrantsExtra', 'Extra on finishing', 'When a token reaches home'],
  ].map(([id, label, desc]) => ({
    id,
    label,
    desc,
    options: [true, false],
    format: onOff,
    read: (s) => s.rules[id],
    write: (s, v) => ({ ...s, rules: { ...s.rules, [id]: v } }),
  })),
];


