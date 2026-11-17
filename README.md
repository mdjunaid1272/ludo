# Ludo

A local (hot-seat) Ludo game for 2-4 players, built with [Phaser](https://phaser.io) 4, JavaScript ES modules and
[Vite](https://vite.dev). It runs in any modern browser on desktop, tablet and phone (touch or mouse).

Modes: **Local Multiplayer** (take turns on one device; a popup asks for 2, 3 or 4 players and which colours play) and
**Player vs Computer** (a popup asks for 2, 3 or 4 players and your colour; the computer plays the other seats at Easy, Normal or Hard). **Online Multiplayer** (rooms with a 4-letter code; needs the game server, see [docs/ONLINE.md](docs/ONLINE.md)). Not included yet: Android packaging.

## Requirements

- Node.js `^22.13`, `24.x` or `26+` (see `.nvmrc`), with npm.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 (hot reload) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally (http://localhost:4173) |
| `npm test` | Run the unit tests (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run check` | Lint, test and build: run this before sharing changes |
| `npm run server` | Start the game server (serves `dist/` and online rooms) at http://localhost:8080 |
| `npm run archive` | Create a clean source zip in `archives/` (never contains `node_modules` or `dist`) |

The production build uses relative URLs (`base: './'`), so the contents of `dist/` can be hosted from any folder.

## Playing

Click or tap the die (or press Space), then click or tap one of the glowing tokens. If a roll leaves only one legal move, it is played for you after a short pause (the token is highlighted first). In Player vs Computer the computer
rolls and moves by itself; its chosen token is highlighted for a moment before it moves.
**Settings** lets you pick 2-4 players, the computer skill, and the rules (see [docs/RULES.md](docs/RULES.md) and
[docs/AI.md](docs/AI.md)); choices are saved in the browser.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: `src/game` is the rules engine and turn flow (no Phaser, fully
unit tested), `src/config/layout.js` computes the responsive layout, and the rest is Phaser rendering.

## Responsive layout

The layout is computed from the screen size (`src/config/layout.js`):

- **Portrait:** a header (title, buttons, status, die, player chips) above the board.
- **Landscape:** the board on the left and the HUD in a column on the right.
- Touch targets are kept at least 44 px and text at least 12 px *as rendered*, however small the screen.
- Rotating the device rebuilds the screen and carries the game in progress across.

## Asset sheet

[docs/assets-sheet.png](docs/assets-sheet.png) shows every visual in the game (board, tokens, dice, buttons, palette). It is generated from the game's own drawing code: with `npm run dev` running, open `/tools/assets.html`.

## Notes for this folder (Google Drive)

If the project lives in a synced Google Drive folder, `npm install` can fail with write errors (`EBADF`) because of the
many small files in `node_modules`. Install in a normal local folder and copy `node_modules` across, or move the project
out of Drive. Do not sync `node_modules` or `dist` into archives; use `npm run archive`.

## Testing

`npm run check` is the full gate. Be aware of its limits: `npm run build` does not run the game, and the unit tests run
without a browser. Real behaviour (touch, rotation, rendering) needs a browser run; `docs/ARCHITECTURE.md` describes the
dev-only hooks used for that.
