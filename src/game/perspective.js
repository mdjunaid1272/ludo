import { PLAYER_IDS } from './path.js';

// Seats and colours are two different things.
//
// A SEAT (one of PLAYER_IDS: 'red', 'green', 'yellow', 'blue') is who plays where on the board: it decides the yard,
// the track, the turn order and who owns which token. Seats are unique, the server decides them, and nothing here changes them.
//
// A DISPLAY COLOUR is only how one screen paints a seat. In an online game everybody may ask for the same favourite
// colour, so each screen builds its own map from seats to display colours: your own seat is painted in the colour
// you asked for, and every other seat gets a different colour. Two screens may paint the same seat differently.

// Returns { [seat]: displayColour } for the screen of the person sitting at `seat` who asked for `preferred`.
//   seats      - every seat in the game (the order does not matter; the result does not depend on it)
//   Own seat   - preferred (or the seat's own colour when nothing was asked for).
//   Other seats - keep their own colour when it is not taken yet, so a screen with no clash looks like the usual board;
//                 a seat whose colour is taken gets the first unused colour, in the fixed order of PLAYER_IDS, so the
//                 same input always gives the same map.
// Every seat gets a different colour, as long as there are no more seats than colours.
export function perspectiveColors({ seat, preferred = null, seats }) {
  const map = {};
  const used = new Set();
  const mine = PLAYER_IDS.includes(preferred) ? preferred : seat;
  if (seats.includes(seat)) {
    map[seat] = mine;
    used.add(mine);
  }
  const others = PLAYER_IDS.filter((s) => s !== seat && seats.includes(s));
  for (const s of others) {
    if (!used.has(s)) {
      map[s] = s;
      used.add(s);
    }
  }
  for (const s of others) {
    if (map[s]) continue;
    const free = PLAYER_IDS.find((c) => !used.has(c));
    map[s] = free;
    used.add(free);
  }
  return map;
}

// The same colours for every seat: how local games and games against the computer are shown.
export const identityColors = (seats = PLAYER_IDS) => Object.fromEntries(seats.map((s) => [s, s]));
