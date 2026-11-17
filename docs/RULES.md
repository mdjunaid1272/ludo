# Ludo rules

This game implements one specific Ludo variant. The rules engine lives in
`src/game/GameState.js` (no Phaser code) and the options below are set in
`src/game/rules.js`. Pass overrides with `new GameState({ rules: { blockades: true } })`.

## Board and tokens

- 2 to 4 players, each with 4 tokens. Turn order is clockwise: red, green, yellow, blue.
- The shared track has 52 cells. Each colour enters at its own start cell, 13 cells apart.
- A token's **progress** counts its own steps: `-1` in the yard, `0` on its start cell,
  `0..50` on the shared track, `51..55` in its home column, `56` finished.
  A token therefore travels 51 track cells (never the cell just before its start), then
  turns into its own home column.

## Taking a turn

1. Roll one die.
2. Pick one token that can legally move that exact number of steps. If none can, the turn ends.
3. If you earned a bonus roll (below) you roll again, otherwise play passes to the next player.

## Movement

- A token leaves the yard **only on a 6**, landing on its start cell.
- A token must reach the finish **by exact roll**: progress may not exceed 56.
- Tokens in the home column (51-55) cannot be captured and are never blocked.
- Several of your own tokens may share a cell.

## Safe cells

Eight cells are safe: every colour's start cell, plus the star cell 8 steps after each start.
A token on a safe cell cannot be captured, and tokens of different colours may share it.

## Captures

Landing on a track cell that holds opponent tokens, on a cell that is not safe, sends **every**
opponent token there back to its yard (unless blockades are on, see below). You never capture
your own tokens. Tokens in the yard, in a home column or finished cannot be captured.

## Bonus rolls (configurable)

| Rule | Default | Meaning |
| --- | --- | --- |
| `sixGrantsExtra` | `true` | Rolling a 6 earns another roll. |
| `sixWithoutMoveGrantsExtra` | `true` | ...even if that 6 could not be played. |
| `captureGrantsExtra` | `true` | Capturing a token earns another roll. |
| `finishGrantsExtra` | `true` | Bringing a token home earns another roll. |

## Triple six (`tripleSix`)

- `'forfeit'` (default): the third 6 in a row is void. The token is not moved and the turn ends.
  The counter counts consecutive 6s by the same player, including bonus rolls, and resets on any
  non-6 roll or when play passes to the next player.
- `'off'`: no limit on consecutive 6s.

## Blockades (`blockades`, default `false`)

When on, two or more tokens of one colour on the same track cell form a blockade. Opponents may
not land on it **or move past it**. This applies to every track cell, including safe cells and
a colour's own start cell (so a blockade on your start cell stops you leaving the yard).
It never affects the owner's tokens or anyone's home column. With blockades on, a pair can never be
captured, because landing on it is illegal.

## Winning

The first player to bring all four tokens to the finish wins; the game ends immediately.

## Engine phases

The engine is a small state machine and rejects calls made in the wrong phase:
`roll` -> `rollDice()` -> `move` (a legal move exists) or `end`;
`move` -> `moveToken(i)` -> `end` or `gameOver`; `end` -> `endTurn()` -> `roll`.
A roll can therefore be used exactly once.

## Starting a game and changing the rules

**Local Multiplayer** opens a popup: choose 2, 3 or 4 players, then (for 2 or 3) tap to choose which colours take
part and press Start. With 4 players every colour plays, so the game starts straight away. Turn order always follows
the board clockwise (red, green, yellow, blue) among the chosen colours, whatever order they were tapped in.

**Player vs Computer** opens a similar popup: choose 2, 3 or 4 players, then your own colour. You sit first and move
first; the others follow clockwise, and with two players the computer sits opposite you.

The Settings screen (Menu > Settings) edits the default player count for Local Multiplayer, the computer skill and every
option above. Choices, including the last popup selections, are saved in the browser (localStorage). Reset defaults
restores the rules in this document.