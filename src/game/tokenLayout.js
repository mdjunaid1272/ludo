import { FINISHED, positionFor } from './path.js';

export const tokenKey = (color, index) => `${color}-${index}`;

const STACK_RADIUS = 0.2; // grid units: how far stacked tokens fan out from the cell centre

// Pure layout: where each token sits, in grid units, and at what scale.
// Tokens sharing a track cell (any colour) are shrunk and fanned out so none is hidden.
// `tokens` is { color: [progress x4] }. Returns Map<tokenKey, { gx, gy, scale }>.
export function computeTokenSlots(tokens) {
  const groups = new Map();
  for (const [color, list] of Object.entries(tokens)) {
    list.forEach((progress, index) => {
      const { gx, gy } = positionFor(color, progress, index);
      const shareable = progress >= 0 && progress < FINISHED;
      const groupKey = shareable ? `${gx},${gy}` : tokenKey(color, index);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ key: tokenKey(color, index), gx, gy });
    });
  }

  const slots = new Map();
  for (const group of groups.values()) {
    const n = group.length;
    const scale = n === 1 ? 1 : n === 2 ? 0.75 : 0.62;
    group.forEach(({ key, gx, gy }, k) => {
      const angle = (2 * Math.PI * k) / n - Math.PI / 2;
      const r = n > 1 ? STACK_RADIUS : 0;
      slots.set(key, { gx: gx + Math.cos(angle) * r, gy: gy + Math.sin(angle) * r, scale });
    });
  }
  return slots;
}
