// Configurable Ludo rules. See docs/RULES.md for what each option means.
export const DEFAULT_RULES = Object.freeze({
  // Three sixes in a row: 'forfeit' = the third six is void and the turn ends, 'off' = no limit.
  tripleSix: 'forfeit',
  // Opponents may not land on or pass a cell holding two or more tokens of one colour.
  blockades: false,
  // Rolling a 6 earns another roll.
  sixGrantsExtra: true,
  // ...even when the 6 could not be played (no legal move).
  sixWithoutMoveGrantsExtra: true,
  // Capturing a token earns another roll.
  captureGrantsExtra: true,
  // Bringing a token home earns another roll.
  finishGrantsExtra: true,
});

const TRIPLE_SIX_MODES = ['off', 'forfeit'];

// Merges overrides onto the defaults and rejects unknown keys or bad values.
export function resolveRules(overrides = {}) {
  const rules = { ...DEFAULT_RULES };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in DEFAULT_RULES)) throw new Error(`Unknown rule: ${key}`);
    if (key === 'tripleSix' ? !TRIPLE_SIX_MODES.includes(value) : typeof value !== 'boolean') {
      throw new Error(`Invalid value for rule ${key}: ${value}`);
    }
    rules[key] = value;
  }
  return Object.freeze(rules);
}
