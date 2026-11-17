// The quick chat messages, reactions and emojis players can send in an online game. Shared by the server (which only
// accepts these ids) and the game (which shows them), so both always agree. Nothing a player types is ever sent:
// only one of these ids.
//   kind 'chat'     - a short message, shown in a bubble with the sender's name
//   kind 'reaction' - an animation (a laughing face, a burst of confetti)
//   kind 'emoji'    - one emoji, popped above the avatar
export const REACTIONS = Object.freeze([
  { id: 'gg', kind: 'chat', text: 'Good game!' },
  { id: 'nice', kind: 'chat', text: 'Nice move!' },
  { id: 'wp', kind: 'chat', text: 'Well played!' },
  { id: 'hello', kind: 'chat', text: 'Hello!' },
  { id: 'laugh', kind: 'reaction', text: 'Laugh' },
  { id: 'celebrate', kind: 'reaction', text: 'Celebrate' },
  { id: 'joy', kind: 'emoji', emoji: '😂', text: 'Laughing' },
  { id: 'love', kind: 'emoji', emoji: '😍', text: 'Love' },
  { id: 'cool', kind: 'emoji', emoji: '😎', text: 'Cool' },
  { id: 'cry', kind: 'emoji', emoji: '😭', text: 'Crying' },
  { id: 'party', kind: 'emoji', emoji: '🎉', text: 'Celebration' },
].map(Object.freeze));

const BY_ID = new Map(REACTIONS.map((r) => [r.id, r]));
export const reactionById = (id) => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);
export const isReactionId = (id) => reactionById(id) !== null;

// The shortest time between two of a player's sends: chat messages share one limit, reactions and emojis another.
export const COOLDOWN_MS = Object.freeze({ chat: 2000, reaction: 1000, emoji: 1000 });
export const cooldownGroup = (kind) => (kind === 'chat' ? 'chat' : 'react');

// How long a message / animation stays on screen.
export const SHOW_MS = Object.freeze({ chat: 3000, reaction: 2600, emoji: 2400 });
