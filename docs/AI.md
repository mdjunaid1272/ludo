# Computer players

Player vs Computer: tapping it opens a popup that asks how many players (2, 3 or 4) and then which colour you want; the computer plays every other seat. You sit first, so you move first, and the others follow clockwise (with two players the computer sits opposite). Your last choice is remembered and outlined in the popup.
The skill level is set in Settings (Computer skill) and applies to all computers.

## How a computer chooses

`src/game/ai.js` (`chooseMove(state, level, rng)`) is a pure function: it reads the game state and returns which token
to move. It never changes the state. The turn flow itself (rolling, pauses, animation) is in `TurnController`, which treats
computer players like any other player but starts their turns by itself, takes the pick from `chooseMove`, and ignores
human clicks while a computer is playing.

Each legal move gets a score:

| Feature | Effect |
| --- | --- |
| Bring a token home | big bonus |
| Capture an opponent token | big bonus, larger for tokens that have travelled further |
| Leave the yard | bonus |
| Enter the home column | bonus (the token is then safe) |
| Land on a safe cell | bonus |
| Land where opponent tokens could hit it with one roll (1-6 cells behind) | penalty per threatening token |
| Move a token that is currently threatened | bonus |
| Progress | small bonus for distance travelled |

## Levels

| Level | Behaviour |
| --- | --- |
| Easy | A random legal move. |
| Normal | The scoring above plus a lot of random noise, so it often plays well but regularly makes mistakes. |
| Hard | The scoring with no noise: always the best-scoring move. |

## How strong are they? (measured)

Win rates of the first-named level, over 3000 games with seeds that were not used for tuning, alternating seats:

| Match | Result |
| --- | --- |
| Hard vs Easy | 92% |
| Normal vs Easy | 83% |
| Hard vs Normal | 65% |
| Hard vs 3 Normals (4 players; 25% would be even) | 40% |

`tests/ai.test.js` asserts these tiers with margin (fixed seeds, so the tests are repeatable).

### Why the levels differ by mistakes, not by a cleverer algorithm

Ludo is mostly dice. I first tried to make Hard smarter by tuning the scoring weights against Normal. On the games
used for tuning it won 56%, but on fresh games it won only 49.7%: the gain was overfitting. A better scoring function
alone made no measurable difference, so Hard and Normal now share the same scoring and differ in how often the AI errs.
This gives clearly separated levels. It also means even Hard can lose a game it "should" win, because the dice decide a lot.

## If the AI ever fails

If `chooseMove` throws, the controller reports the error and retries. After three failures in a row it hands that colour to
a person (the game shows the move prompt for that colour) so the game can never freeze.
