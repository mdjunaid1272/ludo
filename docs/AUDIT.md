# Ludo – audit report (updated 2026-10-29)

State now: 789 tests in 23 files pass; ESLint is clean; `npm run check` (lint, tests, build) completes; `npm audit --omit=dev` reports 0 vulnerabilities. 48 source files in `src/` and `server/`. Stack: Phaser 4.2.1, Vite 8.3.5, Vitest 5.0.5, ESLint 10, `ws` 8.22.0.

## 1. Features delivered

Board, tokens, dice, captures, safe cells, home lane; configurable rules; Player vs Computer (easy/normal/hard); Local Multiplayer; setup popups; settings (saved); responsive layout; online play with an authoritative server.

Since the last report:
- **Splash page** has four buttons: Player vs Computer, Local Multiplayer, **Play Online**, **With Friends** (the single Online Multiplayer button is gone). Landscape uses a 2x2 grid.
- **Play Online:** one tap starts a search for a 4-player public match; after 20 s computers fill empty seats and the game starts; Cancel leaves.
- **With Friends:** create a room for 1, 2 or 3 friends (2-4 seats) with a 4-letter code, or join with a code. Back returns to the splash page.
- **Desktop web:** the game is a centred 9:16 box (at most 1080x1920, at least 320 wide) on a gradient page with a slow ambient animation. Phones/tablets use the full screen.

## 2. How it was verified

| Area | Evidence |
| --- | --- |
| Rules, turn flow, AI | Unit tests on pure `src/game`; AI win-rate simulations |
| Layout | Device-matrix tests (~26 viewports incl. the desktop 9:16 boxes): no overlap, 44 px touch targets |
| Matchmaking and rooms | 15 tests with a fake clock; real-WebSocket integration tests; deliberate-breakage checks (3 of 4 broke tests as expected; the 4th is a redundant guard) |
| Real browser (headless Edge, touch) | Scripted runs with up to 5 simulated phones: search, join, 20 s fill, cancel, friends create/join, Back navigation, menu at 3 sizes; 17/17 and 8/8 checks |
| Desktop browser (headless Edge, mouse) | Screenshots at 1920x1080, 1366x768, 500x900; box measured exactly 608x1080 at 1920x1080 |
| Production bundle | Built and served; dev hooks are absent from production |

## 3. Bugs found and fixed (all time, grouped)

Rules and play:
1. **Could not leave the yard on a 6** when an opponent had two tokens on your start cell, even with Blockades off (the check ignored the setting). Fixed in `GameState.js`; test added and confirmed to fail on the old code.
2. Blank game after build (a leftover line removed by tree-shaking); lint and a module-load test now guard this.
3. Hard AI was no stronger than normal; replaced with noise tiers (hard vs normal about 65%).

Online:
4. Settings `save()` reported success without storage; stale status after an unexpected close; silent client drift after lost events (added sequence check and resync); idle or disconnected players lost control (added away timeout, disconnect grace, notices, foreground reconnect check).

UI:
5. Several screens overflowed on some devices (found by the device matrix).
6. **Game panel pushed down about 70 px** on tall screens (canvas margin collapsing through its container) - fixed with `display: flow-root`.
7. **Back on the With Friends screen** went to the wrong screen (its own button was wired separately from the Esc handler) - fixed and browser-tested.
8. Board PNG export was missing safe-cell stars - re-exported.

Several of my own tests were wrong at first (including three with meaningless `|| true` assertions, and one test that waited on a screen that no longer existed); these were fixed in the tests, not the product.

## 4. Security review (server)

Present: strict message validation, 4 KB payload cap, rate limit (20 msg/s, burst 40), connection caps (1000 total, 20 per IP), heartbeat, cryptographic room codes and seat tokens, path-traversal-safe static serving, optional origin allow-list, per-message error isolation. New: `quick` messages accept only sizes 2 and 4; matchmaking rooms refuse start/colour/computer commands from players.

Gaps:
- **No TLS** in the server; public use needs an HTTPS/WSS proxy.
- **Matchmaking can be abused:** one client can open many searches only up to the existing connection and room limits (500 rooms); there is no per-player queue limit or ban list.
- **No accounts, names or chat.**
- Per-IP limit sees only the proxy address behind a proxy.

## 5. Known limitations and unverified items

- **Real phones:** the earlier report that online play "was not working properly" on a phone is not confirmed fixed; I have only tested in headless Edge. Matchmaking with real strangers over the internet is untested (the server so far ran only on your Wi-Fi).
- **Play Online is 4-player only.** The server also supports 2-player matches, but no button offers them.
- **Rematch after a Play Online match** turns the room into an ordinary friends room (code and host); it does not start a new search.
- **Matches with one real person** start after 20 s against 3 computers; there is no "no players found" message.
- **Browsers:** automated runs used headless Edge only; Safari/iOS and Firefox are untested. Ambient animation was not watched in motion.
- **Space inside the desktop box:** content is narrower than 9:16, so there are dark strips above and below it (about 90 px each at 1080 tall).
- **Rooms are in memory in one process:** a restart ends all games.
- **Android packaging is not built.**
- **Flaky test:** `tests/onlineFullStack.test.js` (a full game with a third of events lost) timed out at 30 s in two consecutive runs once, then passed in 8 s alone and in the next full check. Cause not found. If it fails, rerun.
- **Stale archives:** `archives/ludo-web-upload.zip` and `archives/ludo-202610270643.zip` predate the matchmaking, menu, desktop layout and yard-exit fix. Rebuild them before uploading.
- **`ludo.zip`** (your 38 MB file) disappeared from the folder early on; I did not delete it.
- The project is on Google Drive (`npm install` fails there; installs were staged locally) and is not a git repository.

## 6. Recommendations (priority order)

1. Test Play Online and With Friends on real phones on the same Wi-Fi, then over the internet.
2. Rebuild the upload and source archives before deploying.
3. Put the server behind HTTPS/WSS before exposing it publicly.
4. Decide whether Play Online should offer 2 players, and show a message when no one was found.
5. Test iOS Safari and Firefox.
6. Initialise git; Android packaging only after 1-3.
