# Architecture

```
src/
  game/        Pure logic. No Phaser, no DOM. Unit tested.
    GameState.js      Rules engine and phase machine (see docs/RULES.md)
    rules.js          Rule options and validation
    path.js           Board model: track, home lanes, yards, safe cells
    tokenLayout.js    Where each token sits, including fanning out stacked tokens
    ai.js             Computer players: chooseMove(state, level) (see docs/AI.md)
    TurnController.js Turn flow (roll -> pick -> move -> capture -> next), input lock, recovery, computer turns
    Cancelled.js      Error used to abort work when a scene shuts down
  systems/
    Animator.js       Promise tweens/delays that reject with Cancelled on scene shutdown
    ViewportWatcher.js Rebuilds the active scenes (carrying a game in progress) when the layout must change
  views/
    PhaserGameView.js The Phaser implementation of the TurnController's view interface
  objects/            Token, TokenSet, Dice, MoveHints, Effects, Button: small Phaser display objects
  ui/                 Hud, Modal (dialogs), SetupDialog, Toast and theme
  board/              Drawing of the static board (uses game/path.js data)
  scenes/             Boot, Menu, Settings, Game. GameScene only wires the pieces together
  config/settingsRows.js, settingsStore.js   What the Settings screen edits, and saving it
  config/             Constants, the Phaser game config, and layout.js (responsive layout, pure and unit tested)
server/               The online game server (Room, RoomManager, HTTP/WebSocket), see docs/ONLINE.md
  src/online/         Protocol (shared), connection session, the client's copy of an online game
tests/                Vitest suites (rules, path, board drawing, layout, controller, animator, settings, module loading)
```

## Data flow

1. A click on the die or a token calls `TurnController.requestRoll()` / `requestMove(i)`.
2. The controller checks the lock, the phase and the move's legality. Invalid input is ignored.
3. It updates `GameState`, then awaits view calls (`animateRoll`, `animateMove`, `settle`, ...).
4. The view reads `GameState.tokens` only to compute positions via `tokenLayout.js`.

## Rules for keeping it safe

- **One lock.** While an animation sequence runs the controller ignores all input, so double clicks
  cannot roll twice or move twice. The die and tokens are also made non-interactive in the view.
- **Shutdown.** `Animator` rejects every pending animation with `Cancelled` when the scene shuts down
  (Restart, Menu, destroy), and `TurnController.dispose()` stops any sequence that was awaiting.
  Nothing runs against destroyed objects.
- **Errors.** An unexpected error inside a turn is reported through `onError`, the lock is released and
  the UI is put back into a playable state.
- **Single source of truth for the board.** `drawBoard.js`, token positions and the rules all read
  `game/path.js`.

## Verifying in a browser

In development builds (`npm run dev`) `GameScene` exposes `window.__ludo = { scene, state, controller, view }`
so browser tests can set up positions and read state. It is removed from production builds
(`import.meta.env.DEV`). `npm run build` does not execute game code, so it cannot catch a module that
throws on load; `tests/modules.test.js` covers that, and real behaviour needs a browser run.

## Responsive layout

`config/layout.js` computes every position and size from the viewport (portrait: header above the board;
landscape: HUD column beside it) and guarantees minimum *rendered* sizes (44 px touch targets, 12 px text).
Modules read the shared `layout` object when they draw. `ViewportWatcher` re-applies it on resize/rotate; when the
logical canvas size changes it resizes the canvas and restarts the active scenes. `GameScene.getRestartData()` hands
the live `GameState` to the rebuilt scene, and `TurnController.start()` resumes from whatever phase it was in.
`tests/layout.test.js` checks 18 device sizes for clipping, overlap, minimum sizes and text fit.

## Quality gates

`npm run check` = ESLint + unit tests + production build. ESLint catches undefined names inside functions that no test
runs; `tests/modules.test.js` catches modules that throw on load; neither replaces a real browser run.

## Avatars

Every player of a game gets a different random avatar (a picture from `img/avatars/`), drawn next to that player's yard with
a ring in the player's colour; the avatar of the player whose turn it is is bright, the others faded.

- `src/game/avatars.js` picks them from a seed (pure, tested). A game on one device uses a fresh random seed, kept while the
  screen is rebuilt (rotating the phone) and replaced by Restart. An online room uses its code as the seed, so every player
  sees the same avatar for the same colour.
- The game reads small copies from `img/avatars-small/` (made by `npm run build:avatars`, 128 px, a few KB each). To add an
  avatar, put a PNG in `img/avatars/` and run that command; no code change is needed. The file name (without `.png`) becomes
  its key (`avatar-<name>`).
- Positions come from `layout.hud.avatar`: the outer left and right edges of the rows the die uses, above and below the
  board. A very short screen (the "stacked" portrait arrangement, with no row below the board) has no avatars.