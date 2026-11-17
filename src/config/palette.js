import { PLAYERS } from './constants.js';

const byId = (id) => PLAYERS.find((p) => p.id === id);

// How one screen paints each seat: `colors` maps a seat to the colour it is shown in (see game/perspective.js).
// entry(seat) is the player record (label, colour) of the DISPLAY colour, with the seat as its id, so drawing code can
// keep using the seat for positions and logic and only ask the palette how to paint it. Seats missing from the map
// are painted in their own colour.
export function makePalette(colors = {}) {
  const shown = (seat) => byId(colors[seat] ?? seat);
  return {
    colors,
    entry: (seat) => ({ ...shown(seat), id: seat }),
    color: (seat) => shown(seat).color,
    label: (seat) => shown(seat).label,
    // Pure yellow is unreadable as text on the dark background, so text uses a deeper shade.
    textColor: (seat) => (shown(seat).color === 0xfdd835 ? 0xfbc02d : shown(seat).color),
  };
}

export const IDENTITY_PALETTE = makePalette();
