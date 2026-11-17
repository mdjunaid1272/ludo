# Online multiplayer

Online play needs the game server in `server/`. It serves the built game and runs the rooms, on one port.

## Running it

```
npm run build        # builds the game into dist/
npm run server       # serves dist/ and the WebSocket on http://localhost:8080
```

Open the printed address (the server also prints your address on the local network, so phones on the same Wi-Fi can join).
For development, run `npm run dev` (port 5173) **and** `npm run server` (port 8080): the page then connects to port 8080
automatically.

| Setting (environment variable) | Meaning | Default |
| --- | --- | --- |
| `PORT` | port to listen on | 8080 |
| `HOST` | address to listen on | 0.0.0.0 |
| `STATIC_DIR` | folder with the built game | dist |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to open WebSockets (empty = any); a refusal is a 403 with the reason in `X-Ludo-Reject` | any |
| `TURN_TIMEOUT_MS` | how long a person may take before the computer plays for them (shown as a countdown ring on their avatar) | 15000 |
| `AWAY_TIMEOUT_MS` | the time a person gets on their next turns after they have timed out once | 15000 |
| `TRUST_PROXY` | `1` behind nginx / Cloudflare: count each person's own address (`CF-Connecting-IP` / `X-Forwarded-For`) for the per-address limit | off |
| `MAX_CONNECTIONS_PER_IP` | connections one address may keep open | 20 |
| `DISCONNECT_LEAVE_MS` | in a game: how long a person may be offline before they count as having left (the computer keeps the seat) | 10000 |
| `DISCONNECT_GRACE_MS` | how long the computer waits before playing for someone whose connection dropped | 8000 |
| `AI_THINK_MS`, `AI_PICK_MS` | how long a computer waits before rolling / moving | 900 / 700 |
| `LOBBY_GRACE_MS` | how long a disconnected person keeps their lobby seat | 60000 |
| `MATCH_WAIT_MS` | "Play online": how long a match waits for other people before computers fill the seats | 20000 |

When a connected person's roll leaves only one legal move, the server plays it for them after a short pause (it is announced as `autoMove` in the roll event so clients do not prompt).

To point a build at a different server, open the game with `?server=wss://your.host/ws` in the address.

Deployment behind nginx / Cloudflare, process management and diagnosing `Could not connect` (`npm run check:online`): see `deploy/DEPLOY.md`.

## Game files on ordinary web hosting

Online play needs the Node game server; plain web hosting (FTP) can only show the game and run the offline modes. If the game files are on web hosting and the game server runs somewhere else, edit `config.js` next to `index.html` (source: `deploy/config.js`) and set `window.LUDO_SERVER = 'wss://your-server/ws'` (`ws://` without HTTPS; a page opened over https needs `wss://`). Leave it empty when the game server itself serves the page. `?server=` in the address overrides it.

## Playing

1. The main menu has two online buttons: **Play Online** and **With Friends**. (If this browser has a saved seat, both
   first show a screen offering **Rejoin room**.)
2. **Play online:** a popup asks for your token colour, then the search starts: you are put in a public 4-player match with other people. You get the colour you picked unless someone in that match already has it (then you are seated in another free colour, so people are not split across rooms).
   It starts a moment after the last seat fills; if not enough people come, computers start taking the empty seats one by one when 5 to 8 seconds of the 20-second wait (`MATCH_WAIT_MS`) are left, and the game starts as soon as the last seat is taken. On the waiting screen they arrive like people, with ordinary names. Matches use the default rules and normal computer skill, and nobody manages them
   (no colour choice, no Start button). **Cancel** leaves the search. In a 2-player match the second seat is opposite
   the first. After a match, **Rematch** turns the room into an ordinary friends room with a code and a host.
3. **With friends:** **Create a room** for 1, 2 or 3 friends and share the 4-letter code, or **Join with a code**
   (on-screen keypad; on a computer you can also type the letters).
3. In the lobby you can tap an empty colour to sit there. The host can **Add computer** (tap a computer's row to remove it)
   and press **Start game** once two seats are taken.
4. After a game the host can press **Rematch** to return everyone to the lobby.

Games use the rules and computer skill chosen in Settings by whoever **creates** the room.

## What happens when things go wrong

- **A person loses connection (or it is too weak to keep up):** their phone keeps trying to reconnect by itself, and the game waits for them (nobody plays for them). The server notices a silent connection within 5-10 seconds. If they are still offline after **10 seconds** (`DISCONNECT_LEAVE_MS`) they have **left the game completely**: their tokens leave the board, they get no more turns, and **the computer does not take the seat**. The others are told, and play on; if only one player is left that player wins (the rankings put the players who left last, the latest to leave first). If they come back they are told they left the game. Coming back within the 10 seconds puts them back in their own seat with the current state. If everybody is offline at once the game just waits (nobody is made to leave). Leaving through the Menu button does the same.
- **A person closes the page:** the seat is remembered in the browser; the online buttons then offer **Rejoin room**.
- **A person is idle for too long:** the computer rolls and plays its best token for them (and they are told). On their following turns they get the same window (AWAY_TIMEOUT_MS) to act themselves, so they are never locked out; acting at any time puts them back to normal.
- **A person leaves for good:** the computer takes their colour and the others carry on.
- **The screen is rotated:** the screen is rebuilt and the game continues.
- **Nobody is connected:** the game pauses (it does not play on alone). A room is removed after 10 minutes with nobody in it.
- **The server restarts:** rooms are kept in memory only, so they are lost; players are returned to the menu.

## Colours: seats and what each screen paints

A **seat** (red, green, yellow or blue) is where a person plays: the yard, the track, the turn order and who owns which token. Seats are unique and the server decides them; the game, the events and the snapshots only ever name seats.

A **colour** is only how one screen paints a seat. Several people may ask for the same colour (`preferred` in the `joined` message and `youPreferred` in the room information; the server keeps it per person and gives it back on rejoin). Each screen builds its own map with `perspectiveColors` (`src/game/perspective.js`): your seat in the colour you asked for, every other seat in a different colour (its own colour when that is free, otherwise the first unused one, always the same result for the same seats). `makePalette` (`src/config/palette.js`) turns the map into the colours and names the board, tokens, avatars, die, status line and winner dialog use. Two screens can paint the same seat differently; positions and rules never change.

In the friends lobby, tapping a colour still chooses a seat, and that is also the colour you are shown in. Local multiplayer and games against the computer use the usual colours.

## Names

Every player has a name. The first time the game opens it makes one up (`Player482`, `User729`, `LudoPlayer156`) and saves it in the browser (`localStorage`, key `ludo.profile.v1`, see `src/config/profileStore.js`); it is never replaced afterwards. The profile chip in the top left of the main menu opens the popup where it can be changed. A name is 3 to 16 letters, numbers or underscores (spaces around it are removed); anything else, and names with rude words, is refused with a reason (`src/game/playerName.js`, which the server uses too). The game's picture font only has capitals, so names are *shown* in capitals; they are stored as typed.

The name is sent with `create`, `quick` and `join` and is only a label. People are identified by a public player id the server makes up (`id` in `joined` and in every seat of the room information); the secret token is what rejoins. Two people may have the same name; they still have their own id and seat. The server keeps each person's name with their seat, so a reconnect brings it back, and computers are called `Computer`. Names belong to seats: every screen shows the same name for the same seat, whatever colour it paints that seat in (see the colour section). Names appear in the lobby and match screens, next to each avatar, in the status line, in toasts and on the winner dialog.

## Finishing and positions

A player is **finished** when all four tokens are home. They take the next free position (the first to finish is 1st), take no more turns, and the others play on with their tokens where they were. When only one player is left the game is over and that player takes the last position, so a 4-player game decides 1st to 4th (a 2-player game ends at the first finish). Positions are decided by the rules engine (`src/game/GameState.js`: `rankings`, `winner` = 1st place, `statusOf`, `positionOf`) and everything is about seats, never colours. A player who has just finished gets no bonus roll, and the turn order skips finished players.

Online, the server alone decides this. The `moved` event carries `position` (set when that move finished the player), `winner` and the full `rankings`; clients replay the same rules and ask for a fresh snapshot if their ranking differs. Snapshots carry `rankings`, so a reconnecting player gets them; the room information gives each seat a `status` (`waiting` / `playing` / `finished`) and `position` and is sent again whenever somebody finishes. A player who disconnects or leaves after finishing changes nothing: their seat never gets a turn.

On screen: a popup (position, avatar, name, Continue Match) when somebody finishes and the game goes on (on one device the game waits for Continue; online it closes by itself after a few seconds, because the others keep playing), a medal with the position on the finisher's avatar, and the Final results (everybody in order, Play again / Home, or Rematch / Home online) when the last position is decided. In 3- and 4-player games on one device and against the computer the game now also plays on after the first winner. No match statistics are kept.

## Quick chat, reactions and emojis

In an online game the **Chat** button (where Restart is in other modes) opens a panel with 4 quick chat messages (Good game!, Nice move!, Well played!, Hello!), 2 reactions (Laugh, Celebrate) and 5 emojis (😂 😍 😎 😭 🎉). The list lives in `src/online/reactions.js` and is shared by the game and the server. A tap sends `{ t: 'react', id }`; the server checks that the id is on the list, that the sender sits in this room's game and is connected, and the cooldown (one chat message per 2 s, one reaction or emoji per 1 s, per player), then sends `{ t: 'reaction', seat, playerId, name, id }` to everybody in that room only. Seat, id and name come from the server's own record of the sender, so nobody can react as somebody else; anything else is dropped without an answer. Every screen (the sender's too) shows it when the server's message arrives: next to the sender's avatar (or their die spot on screens without avatars), kept on screen, for about 2.5-3 s. A new one from the same player replaces the old one at once; different players' reactions show side by side. Reactions are not game events: they change nothing in the game and are not part of snapshots.

## The turn countdown

Whoever has to act (roll, or pick a token) has 15 seconds. The server sends the time with the olled, 	urn and snapshot events (	imeoutMs), and the player's avatar shows a ring that empties (green, then amber, then red). When it runs out the server rolls the die if needed and plays the best token (the strongest computer skill, whatever skill the room's computers use). Screens that show no avatars (a tablet held upright) show no ring, but the countdown still applies.

## How it works

The server is **authoritative**: it runs the same rules engine as the game (`src/game`), and clients only send what they want
to do ("roll", "move token 2"). The server checks the request (right player, right phase, legal move), applies it, and
broadcasts numbered events (`rolled`, `moved`, `turn`). Each client keeps its own copy of the game and applies the events
in order, so everyone sees the same thing, and nobody can cheat by sending a different result.

If a client's copy ever drifts (a missed event), it notices from the event numbers (including the server's heartbeat
reply) and asks for a full snapshot, which is checked before it is used.

Files: `server/Room.js` (a room: lobby, seats, the game, computer seats, timers), `server/RoomManager.js` (room codes,
routing, cleanup), `server/index.js` (HTTP + WebSocket, limits), `server/start.js` (command line),
`src/online/protocol.js` (messages and validation, shared), `src/online/OnlineSession.js` (connection, reconnecting),
`src/online/OnlineGame.js` (a client's copy of the game), `src/scenes/OnlineScene.js` (screens).

## Safety measures

- Every message is validated strictly (type, size, fields); invalid input gets an error, never a crash. Messages over
  4 KB close the connection.
- Per-connection rate limit (20 messages per second, bursts of 40); total connection limit (1000) and per-address limit (20).
- Heartbeat: connections that stop answering are dropped.
- Room codes and secret seat tokens come from a cryptographic random generator; a token is only ever sent to its owner
  and is needed to rejoin.
- The static file server refuses paths that leave `dist/` (`..`, encoded forms, null bytes) and only serves GET/HEAD.
- Optional origin allow-list for WebSockets (`ALLOWED_ORIGINS`).
- A bug while handling one message cannot take the server down; it answers with an error.

## Limitations

- **No accounts, names or chat.** People are identified by colour.
- **In-memory rooms, one process.** There is no database; a restart ends all games, and one server process is the limit
  (a few hundred simultaneous games on a small machine).
- **No TLS in the server itself.** For the public internet put it behind a reverse proxy that provides HTTPS/WSS (the page then
  connects with `wss://` automatically). The per-address limit sees the proxy's address unless the proxy is configured to
  pass clients through; adjust `maxConnectionsPerIp` accordingly.
- Cheating is limited to what clients can do through the protocol: they cannot choose dice or illegal moves, but nothing
  stops someone from playing slowly (the idle timeout is the only defence).
