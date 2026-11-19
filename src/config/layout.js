import { SETTING_ROWS } from './settingsRows.js';
import { GLYPH_WIDTH, TEXT_SCALE } from './textMetrics.js';

// Responsive layout, computed from the browser viewport. Pure: no Phaser, so it can be unit tested
// across many screen sizes. All numbers are in logical game pixels; the canvas is then scaled to
// fit the screen (Phaser FIT mode), so `scale` is how many real pixels one logical pixel becomes.
//
// The board is always 720x720 logical (15 cells of 48). What changes is what surrounds it:
//   portrait  - a header above the board (title, buttons, status, die, player chips)
//   landscape - the board on the left and the HUD in a column on the right
// Sizes that must stay usable on small screens (touch targets, text) are given a minimum
// *rendered* size and are enlarged in logical pixels when the screen scales the game down.

export const BOARD = 720;
export const MIN_TOUCH = 44; // real px: smallest comfortable touch target
export const MIN_TEXT = 12; // real px: smallest readable text
// The Restart and Menu buttons are small on purpose (both ask before doing anything), so they may be smaller than MIN_TOUCH.
// The most space (logical px) the game screen puts above the board (and, centred, below it) on a very tall screen. Normally the
// space just fills the screen; the limit is a fixed number, not derived from the screen scale, so near-identical screens
// get the same canvas.
const MAX_HUD_SPACE = 600;
export const PILL_MIN_H = 34; // real px
export const PILL_MIN_W = 72; // real px
const PAD = 16;
const LANDSCAPE_FROM = 1.15; // viewport aspect (w/h) at which we switch to the landscape layout
const TEXT_WIDTH_FACTOR = TEXT_SCALE * GLYPH_WIDTH; // width of a character / the font size asked for, for fit estimates (see textMetrics.js)

export const estimateTextWidth = (chars, fontSize) => chars * fontSize * TEXT_WIDTH_FACTOR;
// The largest font size at which chars characters fit in width, over lines lines.
const fitFont = (chars, width, lines = 1) => (width * lines * 0.98) / (chars * TEXT_WIDTH_FACTOR);
export const STATUS_CHARS = 40; // the longest status message ('YELLOW (CPU) rolled 6: 3rd 6, turn lost' is 39)

const quantize = (n, step) => Math.round(n / step) * step;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// `allowLandscape` is false on a desktop web page, which always gets the portrait layout in a centred column.
export function computeLayout(viewportW, viewportH, allowLandscape = true) {
  const vw = Math.max(1, viewportW);
  const vh = Math.max(1, viewportH);
  return allowLandscape && vw / vh >= LANDSCAPE_FROM ? landscapeLayout(vw, vh) : portraitLayout(vw, vh);
}

export const WEB_MAX_WIDTH = 1080; // the biggest the game box gets on a desktop page (real px): 1080 x 1920, 9:16
export const WEB_MAX_HEIGHT = 1920;
export const WEB_MIN_WIDTH = 320; // in a very short window the box is a little wider than 9:16 rather than too narrow to use

// What the game area is on this device. Phones and tablets (touch) use the whole screen and may go landscape.
// A desktop page gets a portrait box in 9:16 proportions (at most 1080 x 1920), as tall as the window allows and
// centred; the rest of the window is left empty (the page's gradient). In a window too narrow for 9:16 the box
// is simply the window's width.
export function gameAreaFor(innerW, innerH, isTouch) {
  if (isTouch) return { w: innerW, h: innerH, allowLandscape: true };
  const h = Math.min(innerH, WEB_MAX_HEIGHT);
  const w = Math.min(innerW, WEB_MAX_WIDTH, Math.max(WEB_MIN_WIDTH, Math.round((h * 9) / 16)));
  return { w, h, allowLandscape: false };
}

// --- shared pieces ---------------------------------------------------------------------------

const makeUi = (scale) => (base, minReal) => Math.max(base, minReal / scale);

export const MENU_BUTTONS = 4; // Player vs Computer, Local Multiplayer, Play Online, With Friends
const MENU_LABEL_CHARS = 'Player vs Computer'.length; // the longest name shown under a picture
const MENU_TILE_ASPECT = 0.89; // height / width of the picture on each splash button (img/buttons/*.png)

// The four mode buttons are pictures with their name underneath: a 2x2 grid in portrait, one row in landscape.
// They share the space between the subtitle and the bottom of the screen; the pictures keep their wanted size when there is room
// and shrink (never below a touchable size) when there is not.
function menuLayout({ landscape, width, height, ui }) {
  const corner = settingsCorner({ ui, width });
  const profile = profileChip({ ui, corner });
  const head = landscape
    ? { titleY: 78, titleFont: 80, subtitleY: 140, subtitleFont: 24 }
    : { titleY: Math.round(height * 0.2), titleFont: 120, subtitleY: Math.round(height * 0.2) + 95, subtitleFont: 26 };
  const cols = landscape ? 4 : 2;
  const rows = MENU_BUTTONS / cols;
  const colGap = 24;
  const rowGap = 26;
  const labelGap = 8;

  const top = head.subtitleY + head.subtitleFont + 24;
  const bottom = height - (landscape ? 20 : 36);
  const labelWanted = ui(26, 14);
  const widest = Math.min(landscape ? 250 : 300, (width - 60 - colGap * (cols - 1)) / cols);
  const tileFor = (lines) => Math.max(ui(0, MIN_TOUCH), Math.min(widest, (bottom - top - (rows - 1) * rowGap - rows * (labelGap + labelWanted * 1.3 * lines)) / (rows * MENU_TILE_ASPECT)));
  // A name may be a little wider than its picture (the cells are colGap apart). When the longest does not fit on one
  // line at a readable size, every name gets room for two lines and is wrapped.
  const wrapFor = (w) => w + colGap - 4;
  let labelLines = 1;
  let tileW = tileFor(1);
  if (estimateTextWidth(MENU_LABEL_CHARS, labelWanted) > wrapFor(tileW)) {
    labelLines = 2;
    tileW = tileFor(2);
  }
  const labelWrap = wrapFor(tileW);
  const labelFont = labelLines === 1 ? labelWanted : Math.min(labelWanted, labelWrap / estimateTextWidth('Computer'.length, 1)); // 'Computer' is the longest word
  const tileH = tileW * MENU_TILE_ASPECT;
  const cellH = tileH + labelGap + labelFont * 1.3 * labelLines;
  const block = rows * cellH + (rows - 1) * rowGap;
  const first = top + (bottom - top - block) / 2 + cellH / 2; // centred in the free space
  const cx = width / 2;
  return {
    ...head,
    // Each button is a cell: the picture (tileW x tileH) with its name below, cellH tall in all. Positions are the cell's centre.
    buttonXs: Array.from({ length: MENU_BUTTONS }, (_, i) => cx + ((i % cols) - (cols - 1) / 2) * (tileW + colGap)),
    buttonYs: Array.from({ length: MENU_BUTTONS }, (_, i) => first + Math.floor(i / cols) * (cellH + rowGap)),
    buttonW: tileW, buttonH: cellH, tileH, labelFont, labelLines, labelWrap,
    ...corner,
    profile,
  };
}

const SETTINGS_TILE_ASPECT = 0.912; // height / width of img/buttons/setting-button.png

// The Settings button: a picture (no name) in the top right corner of the splash page. settingsX / settingsY are its
// centre; settingsW x settingsH is its size.
function settingsCorner({ ui, width }) {
  const margin = 20;
  const tileW = Math.max(ui(0, MIN_TOUCH / SETTINGS_TILE_ASPECT), 100); // at least MIN_TOUCH tall, which is the smaller side
  const tileH = tileW * SETTINGS_TILE_ASPECT;
  return { settingsX: width - margin - tileW / 2, settingsY: margin + tileH / 2, settingsW: tileW, settingsH: tileH };
}

// The profile chip in the top left corner of the splash page: the player's avatar and name. x / y are its centre.
export const PROFILE_NAME_CHARS = 16; // the longest name (NAME_MAX in game/playerName.js)
function profileChip({ ui, corner }) {
  const margin = 20;
  const h = ui(56, MIN_TOUCH);
  const w = Math.min(380, corner.settingsX - corner.settingsW / 2 - margin * 2);
  const pad = 8;
  const avatar = h - pad * 2;
  const font = Math.min(ui(22, 12), (w - avatar - pad * 3) / estimateTextWidth(PROFILE_NAME_CHARS, 1));
  return { x: margin + w / 2, y: margin + corner.settingsH / 2, w, h, pad, avatar, font };
}

// The profile popup (change your name): a title, your avatar and current name, the text field with its counter and the
// validation message, and Cancel / Save. Its height follows its content; on a short screen the avatar shrinks (or goes).
export const PROFILE_TITLE = 'Your profile';
function profileLayout({ width, height, ui }) {
  const w = Math.min(560, width - 40);
  const inner = w - 48;
  const pad = 22;
  const gap = 14;
  const fit = (chars, wanted) => Math.min(wanted, inner / estimateTextWidth(chars, 1));
  const titleFont = fit(PROFILE_TITLE.length, ui(34, 20));
  const nameFont = fit(PROFILE_NAME_CHARS, ui(32, 14));
  const fieldH = ui(60, MIN_TOUCH);
  const fieldFont = ui(26, 16); // the text typed in the field (a real text box, in the page's own font)
  const noteFont = Math.min(ui(18, 12), inner / 2 / estimateTextWidth(30, 1));
  const footH = ui(56, MIN_TOUCH);
  const fixed = pad + titleFont * 1.2 + gap + nameFont * 1.3 + gap + fieldH + 8 + noteFont * 1.4 + gap + footH + pad;
  let avatar = ui(96, 56);
  const room = height - 16 - fixed - gap;
  if (avatar > room) avatar = room >= 40 ? room : 0; // too small to be worth showing: leave it out
  const avatarBlock = avatar > 0 ? avatar + gap : 0;
  const h = fixed + avatarBlock;
  const top = (height - h) / 2;
  const titleY = top + pad + titleFont * 0.6;
  const avatarY = titleY + titleFont * 0.6 + gap + avatar / 2;
  const nameY = titleY + titleFont * 0.6 + gap + avatarBlock + nameFont * 0.65;
  const fieldY = nameY + nameFont * 0.65 + gap + fieldH / 2;
  const noteY = fieldY + fieldH / 2 + 8 + noteFont * 0.7;
  const footY = noteY + noteFont * 0.7 + gap + footH / 2;
  return {
    w, h, top, cx: width / 2, inner, titleY, titleFont, avatar, avatarY, nameY, nameFont,
    fieldY, fieldW: inner, fieldH, fieldFont, noteY, noteFont, footY, footH, footW: (inner - 16) / 2, footGap: 16, footFont: ui(20, 14),
  };
}

// The popup shown when a player gets all tokens home but others play on: the position, the avatar, the name and a
// Continue button. On a short screen the avatar shrinks (or goes). `l` is a layout object (the current one by default).
export const FINISH_NOTE_CHARS = 'FINISHED 1ST!'.length;
export function finishLayout(l = layout) {
  const { width, height, ui } = l;
  const w = Math.min(520, width - 40);
  const inner = w - 48;
  const pad = 22;
  const gap = 12;
  const posFont = Math.min(ui(72, 36), inner / estimateTextWidth(3, 1));
  const nameFont = Math.min(ui(30, 16), inner / estimateTextWidth(PROFILE_NAME_CHARS, 1));
  const noteFont = Math.min(ui(22, 12), inner / estimateTextWidth(FINISH_NOTE_CHARS, 1));
  const btnH = ui(60, MIN_TOUCH);
  const fixed = pad + posFont * 1.1 + gap + nameFont * 1.3 + 6 + noteFont * 1.3 + gap + btnH + pad;
  let avatar = ui(110, 60);
  const room = height - 16 - fixed - gap;
  if (avatar > room) avatar = room >= 40 ? room : 0;
  const avatarBlock = avatar > 0 ? avatar + gap : 0;
  const h = fixed + avatarBlock;
  const top = (height - h) / 2;
  const posY = top + pad + posFont * 0.55;
  const avatarY = posY + posFont * 0.55 + gap + avatar / 2;
  const nameY = posY + posFont * 0.55 + gap + avatarBlock + nameFont * 0.65;
  const noteY = nameY + nameFont * 0.65 + 6 + noteFont * 0.65;
  const btnY = noteY + noteFont * 0.65 + gap + btnH / 2;
  return { w, h, top, cx: width / 2, inner, posY, posFont, avatar, avatarY, nameY, nameFont, noteY, noteFont, btnY, btnH, btnW: Math.min(inner, 300), btnFont: ui(22, 15) };
}

// The final results: a title, one row per player in finishing order (position, avatar, name) and the buttons. The rows get
// smaller on a short screen.
export const RESULTS_TITLE = 'Final results';
export function resultsLayout(l, count) {
  const { width, height, ui } = l;
  const w = Math.min(560, width - 40);
  const inner = w - 48;
  const pad = 22;
  const gap = 10;
  const titleFont = Math.min(ui(36, 20), inner / estimateTextWidth(RESULTS_TITLE.length, 1));
  const footH = ui(56, MIN_TOUCH);
  const fixed = pad * 2 + titleFont * 1.2 + gap * 2 + footH;
  const rowH = Math.max(32, Math.min(ui(72, 44), (height - 16 - fixed) / count - gap));
  const h = fixed + count * (rowH + gap) - gap + gap;
  const top = (height - h) / 2;
  const titleY = top + pad + titleFont * 0.6;
  const rowsTop = titleY + titleFont * 0.6 + gap * 2;
  const badge = Math.min(rowH * 0.7, 48);
  const avatar = rowH - 12;
  const nameX = (width - inner) / 2 + 12 + badge + 12 + avatar + 12;
  const nameFont = Math.min(ui(26, 14), (width / 2 + inner / 2 - 12 - nameX) / estimateTextWidth(PROFILE_NAME_CHARS + 6, 1), rowH * 0.5);
  return {
    w, h, top, cx: width / 2, inner, titleY, titleFont, rowH, rowGap: gap, badge, avatar, nameX, nameFont,
    rowY: (i) => rowsTop + i * (rowH + gap) + rowH / 2,
    footY: rowsTop + count * (rowH + gap) - gap + gap + footH / 2, footH, footW: (inner - 16) / 2, footGap: 16, footFont: ui(20, 14),
  };
}

// The quick chat / reactions / emojis panel of an online game: three titled sections (4 messages in two columns, 2 reactions,
// 5 emojis in a row). It opens over the middle of the board, away from the die rows, and fits the screen.
export const REACTION_SECTIONS = ['Quick chat', 'Reactions', 'Emojis'];
export const REACTION_LONGEST_LABEL = 'Well played!'.length;
export function reactionPanelLayout(l) {
  const { width, height, ui } = l;
  const w = Math.min(600, width - 40);
  const inner = w - 40;
  const pad = 20;
  const gap = 10;
  const colW = (inner - gap) / 2;
  const btnH = ui(52, MIN_TOUCH);
  const btnFont = Math.min(ui(20, 13), (colW - 20) / estimateTextWidth(REACTION_LONGEST_LABEL, 1));
  const titleFont = Math.min(ui(17, 11), inner / estimateTextWidth(12, 1));
  const emojiW = (inner - gap * 4) / 5;
  const emojiH = Math.max(btnH, Math.min(emojiW, ui(64, MIN_TOUCH)));
  const titleH = titleFont * 1.3 + 6;
  const h = pad + titleH + btnH * 2 + gap + gap * 1.6 + titleH + btnH + gap * 1.6 + titleH + emojiH + pad;
  // Centred on the board, kept on screen.
  const boardCx = (l.boardX ?? 0) + BOARD / 2;
  const boardCy = (l.boardY ?? 0) + BOARD / 2;
  const cx = Math.min(Math.max(boardCx, w / 2 + 8), width - w / 2 - 8);
  const top = Math.min(Math.max(boardCy - h / 2, 8), Math.max(8, height - h - 8));
  const left = cx - inner / 2;
  let y = top + pad;
  const section = () => {
    const ty = y + titleFont * 0.65;
    y += titleH;
    return ty;
  };
  const chatTitleY = section();
  const chatYs = [y + btnH / 2, y + btnH + gap + btnH / 2];
  y += btnH * 2 + gap + gap * 1.6;
  const reactTitleY = section();
  const reactY = y + btnH / 2;
  y += btnH + gap * 1.6;
  const emojiTitleY = section();
  const emojiY = y + emojiH / 2;
  return {
    cx, top, w, h, inner, left, pad, gap, colW, btnH, btnFont, titleFont, emojiW, emojiH, emojiFont: Math.min(emojiH, emojiW) * 0.6,
    titleYs: [chatTitleY, reactTitleY, emojiTitleY],
    chatAt: (i) => ({ x: left + colW / 2 + (i % 2) * (colW + gap), y: chatYs[Math.floor(i / 2)] }),
    reactAt: (i) => ({ x: left + colW / 2 + i * (colW + gap), y: reactY }),
    emojiAt: (i) => ({ x: left + emojiW / 2 + i * (emojiW + gap), y: emojiY }),
  };
}

function settingsLayout({ landscape, width, height, ui }) {
  const rows = SETTING_ROWS.length;
  const maxLabel = Math.max(...SETTING_ROWS.map((r) => r.label.length));
  const fullBtnH = ui(52, MIN_TOUCH);
  const footerH = ui(60, MIN_TOUCH);
  const cols = landscape ? 2 : 1;
  const margin = 30;
  const colW = (width - margin * (cols + 1)) / cols;
  const btnFont = ui(22, 12);
  const btnW = Math.round(estimateTextWidth(9, btnFont) + 40); // fits "4 players" / "No limit"
  const footerY = height - footerH / 2 - 20;
  const titleFont = landscape ? ui(44, 26) : 56;
  const titleY = landscape ? 52 : 80;
  const rowTop = Math.round(titleY + titleFont * 0.6 + 24);
  const perCol = Math.ceil(rows / cols);
  const room = footerY - footerH / 2 - 16 - rowTop;
  // On a very small screen the rows cannot all be touch-sized; then the controls shrink to fit
  // (about 37 px on a 320x480 phone) and `compact` says so. Everywhere else they keep the full size.
  const compact = room / perCol < fullBtnH + 12;
  const btnH = compact ? Math.max(0, room / perCol - 12) : fullBtnH;
  // Rows are at least as tall as the control (plus a gap), up to a comfortable maximum.
  const step = Math.min(Math.max(landscape ? 130 : 96, btnH + 14), Math.max(room / perCol, 0));
  // Shrink the label if it would run into the control; the description sits on its own line.
  const labelRoom = colW - btnW - 44;
  const labelFont = Math.min(ui(24, 15), labelRoom / (maxLabel * TEXT_WIDTH_FACTOR));
  const descFont = ui(15, MIN_TEXT);
  const maxDesc = Math.max(...SETTING_ROWS.map((r) => r.desc.length));
  // Descriptions are dropped on screens too small to show them beside the control.
  const showDesc = maxDesc * descFont * TEXT_WIDTH_FACTOR <= labelRoom;
  return {
    cols, colW, margin, step, rowH: step - 10, rowTop, btnW, btnH, btnFont, compact,
    titleY, titleFont,
    labelFont, descFont, showDesc, labelRoom,
    footerY, footerH, footerFont: ui(22, 15), resetW: 300, backW: 300, // the two footer buttons (their pictures too) are the same size
    rowRect: (i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      return { x: margin + col * (colW + margin), y: rowTop + row * step, w: colW, h: step - 10 };
    },
  };
}

function modalLayout({ width, height, ui }) {
  const w = Math.min(540, width - 40);
  return { w, h: 330, cx: width / 2, cy: height / 2, btnH: ui(64, MIN_TOUCH), btnFont: ui(22, 15), titleFont: 40, messageFont: ui(24, 14) };
}

// The online screens: a stack of buttons (connect, home, create a room), a keypad for typing a room code, and the
// lobby (room code, seats, actions). Landscape puts the lobby in two columns and spreads the keypad over two rows.
export const ONLINE_STACK_LABEL_CHARS = 'Rejoin room BCDF'.length; // the longest label put on a stack button
export const LOBBY_ACTION_LABELS = ['Add computer', 'Start game', 'Leave'];
export const ONLINE_INFO_CHARS = 28; // the longest info line the online screens show
function onlineLayout({ landscape, width, ui }) {
  const titleFont = Math.min(landscape ? ui(40, 24) : ui(52, 26), fitFont('Online Multiplayer'.length, width - 30));
  const titleY = (landscape ? 20 : 40) + titleFont * 0.6;
  // The info line under the title is kept short (at most ONLINE_INFO_CHARS characters) and capped to fit the canvas.
  const infoFont = Math.min(ui(22, 14), (width - 40) / estimateTextWidth(ONLINE_INFO_CHARS, 1));
  const infoY = titleY + titleFont * 0.6 + 16 + infoFont * 0.65;

  // Stack of up to four buttons under the title and an info line.
  const btnW = Math.min(440, width - 40);
  const btnH = ui(76, MIN_TOUCH);
  const stackGap = 20;
  const stackFirst = infoY + infoFont * 0.65 + 28 + btnH / 2;
  const stack = {
    w: btnW, h: btnH, ys: Array.from({ length: 4 }, (_, i) => stackFirst + i * (btnH + stackGap)),
    font: Math.min(ui(28, 16), (btnW - 30) / estimateTextWidth(ONLINE_STACK_LABEL_CHARS, 1)),
  };

  // Keypad: the 20 code letters, then Back / delete / Join.
  const inner = Math.min(landscape ? 1200 : 640, width - 40);
  const cols = landscape ? 10 : 5;
  const keyGap = 10;
  const keyW = (inner - keyGap * (cols - 1)) / cols;
  const keyH = ui(64, MIN_TOUCH);
  const rows = 20 / cols;
  const boxH = ui(88, MIN_TOUCH);
  const boxGap = 14;
  const boxW = Math.min(110, (inner - boxGap * 3) / 4);
  const codeY = infoY + infoFont * 0.65 + 20 + boxH / 2;
  const keysTop = codeY + boxH / 2 + 22;
  const bottomH = ui(64, MIN_TOUCH);
  const bottomY = keysTop + rows * keyH + (rows - 1) * keyGap + 20 + bottomH / 2;
  const left = (width - inner) / 2;
  const bottomW = (inner - keyGap * 2) / 3;
  const keypad = {
    inner, keyW, keyH, keyGap, cols, rows, left, boxW, boxH, boxGap, codeY, codeFont: Math.min(ui(56, 24), boxH * 0.7),
    keyFont: Math.min(ui(28, 16), keyW * 0.6),
    keyRect: (i) => ({ x: left + (i % cols) * (keyW + keyGap) + keyW / 2, y: keysTop + Math.floor(i / cols) * (keyH + keyGap) + keyH / 2, w: keyW, h: keyH }),
    boxRect: (i) => ({ x: width / 2 - (boxW * 4 + boxGap * 3) / 2 + i * (boxW + boxGap) + boxW / 2, y: codeY, w: boxW, h: boxH }),
    bottomRect: (j) => ({ x: left + j * (bottomW + keyGap) + bottomW / 2, y: bottomY, w: bottomW, h: bottomH }),
    bottomFont: ui(22, 15),
  };

  // Lobby.
  const seatH = ui(60, MIN_TOUCH);
  const seatGap = 8;
  const labelFont = ui(18, 12);
  const lobbyCodeFont = Math.min(ui(76, 30), 110);
  const actionH = ui(64, MIN_TOUCH);
  const actionGap = 14;
  const labelY0 = infoY + infoFont * 0.65 + 18 + labelFont * 0.65;
  let lobby;
  if (landscape) {
    const colW = (width - 90) / 2;
    const lx = 30 + colW / 2;
    const rx = 60 + colW + colW / 2;
    const codeLY = labelY0 + labelFont * 0.65 + 8 + lobbyCodeFont * 0.6;
    const row1 = codeLY + lobbyCodeFont * 0.6 + 26 + actionH / 2;
    const row2 = row1 + actionH + actionGap;
    const half = (colW - actionGap) / 2;
    lobby = {
      label: { x: lx, y: labelY0, font: labelFont }, code: { x: lx, y: codeLY, font: lobbyCodeFont },
      seats: Array.from({ length: 4 }, (_, i) => ({ x: rx, y: labelY0 - labelFont * 0.65 + seatH / 2 + i * (seatH + seatGap), w: colW, h: seatH })),
      actions: [{ x: lx - (half + actionGap) / 2, y: row1, w: half, h: actionH }, { x: lx + (half + actionGap) / 2, y: row1, w: half, h: actionH }, { x: lx, y: row2, w: colW, h: actionH }],
    };
  } else {
    const listW = Math.min(520, width - 40);
    const half = (listW - actionGap) / 2;
    const codePY = labelY0 + labelFont * 0.65 + 8 + lobbyCodeFont * 0.6;
    const seatsTop = codePY + lobbyCodeFont * 0.6 + 22;
    const row1 = seatsTop + 4 * (seatH + seatGap) + 12 + actionH / 2;
    const row2 = row1 + actionH + actionGap;
    lobby = {
      label: { x: width / 2, y: labelY0, font: labelFont }, code: { x: width / 2, y: codePY, font: lobbyCodeFont },
      seats: Array.from({ length: 4 }, (_, i) => ({ x: width / 2, y: seatsTop + seatH / 2 + i * (seatH + seatGap), w: listW, h: seatH })),
      actions: [{ x: width / 2 - (half + actionGap) / 2, y: row1, w: half, h: actionH }, { x: width / 2 + (half + actionGap) / 2, y: row1, w: half, h: actionH }, { x: width / 2, y: row2, w: listW, h: actionH }],
    };
  }
  lobby.seatFont = Math.min(ui(22, 14), seatH * 0.42, (lobby.seats[0].w - 50) / estimateTextWidth('YELLOW  Empty (tap to sit)'.length, 1));
  lobby.actionFont = Math.min(ui(22, 15), (lobby.actions[0].w - 20) / estimateTextWidth('Add computer'.length, 1));

  return { titleY, titleFont, infoY, infoFont, stack, keypad, lobby };
}

// The Player vs Computer setup popup: a title, a prompt, one row of choices (the player count, then the
// colour) and a Cancel/Back button. Its height follows its content so it fits any screen.
export const SETUP_TITLE = 'Player vs Computer';
export const SETUP_PROMPTS = ['How many players?', '3 players: pick your colour']; // longest step-2 prompt included
function setupLayout({ width, height, ui }) {
  const w = Math.min(640, width - 40);
  const pad = 24;
  const gap = 22;
  const inner = w - 60;
  const fit = (chars, wanted) => Math.min(wanted, (w - 40) / estimateTextWidth(chars, 1));
  const titleFont = fit(SETUP_TITLE.length, ui(34, 20));
  const promptFont = fit(Math.max(...SETUP_PROMPTS.map((p) => p.length)), ui(22, 14));
  const btnH = ui(80, MIN_TOUCH);
  const backH = ui(67, MIN_TOUCH); // (the Cancel / Back / Start buttons)
  const h = pad + titleFont * 1.2 + 12 + promptFont * 1.3 + gap + btnH + gap + backH + pad;
  const top = (height - h) / 2;
  const titleY = top + pad + titleFont * 0.6;
  const promptY = titleY + titleFont * 0.6 + 12 + promptFont * 0.65;
  const rowY = promptY + promptFont * 0.65 + gap + btnH / 2;
  const backY = rowY + btnH / 2 + gap + backH / 2;
  const countGap = 16;
  const colorGap = 12;
  const colorW = (inner - colorGap * 3) / 4;
  return {
    w, h, top, cx: width / 2, cy: height / 2,
    titleY, titleFont, promptY, promptFont, rowY, btnH, backY, backH, backW: 240, footGap: 16, backFont: ui(20, 14),
    countW: Math.min(150, (inner - countGap * 2) / 3), countGap, countFont: 40,
    colorW, colorGap, colorFont: Math.min(ui(20, 14), (colorW - 16) / estimateTextWidth('YELLOW'.length, 1)),
  };
}

// --- portrait --------------------------------------------------------------------------------

function portraitSizes(scale) {
  const ui = makeUi(scale);
  const statusFont = ui(24, 15);
  return {
    ui,
    pillH: ui(36, PILL_MIN_H),
    pillW: ui(100, PILL_MIN_W),
    diceS: ui(55, 42), // a little bigger than the 44 / 34 it was shrunk to (it was 72 / 56 originally); its touch area is MIN_TOUCH (see Dice)
    statusFont,
    titleFont: ui(40, 24),
    // The height of the die's row: the die, or the status line's three lines if they are taller.
    rowH: Math.max(ui(55, 42), statusFont * 1.3 * STATUS_LINES),
  };
}

// An avatar is a picture with a ring around it (and, in online games, a countdown arc outside the ring); the current
// player's is drawn a little larger. The layout reserves the larger size,
// so the avatar never touches the die next to it.
export const AVATAR_RING = 4; // width of the ring, in game pixels
export const AVATAR_TIMER = 6.5; // room left outside the ring for the countdown arc (online games)
export const AVATAR_ACTIVE_SCALE = 1.1;
export const AVATAR_GAP_PX = 10; // the space between an avatar and the die beside it, in real screen pixels (the same on every screen)
export const avatarOuterSize = (size) => (size + (AVATAR_RING + AVATAR_TIMER) * 2) * AVATAR_ACTIVE_SCALE; // widest the avatar, its ring and the countdown arc get

// The die stands next to the yard of the player whose turn it is. A yard's centre is at column 3 (left) or 12 (right) of
// the 15 board columns, whichever way the board is turned, so the four spots are the same for every turn of the board.
const spotX = (boardX, right) => boardX + (right ? 12 : 3) * (BOARD / 15);

// The status line sits in the die's row, between the two spots at the left and the right: as wide as that gap, and as
// tall as the die. Three lines of it fit the longest message at a readable size.
const STATUS_LINES = 3;
function statusBetween(s, width, dieLeftX) {
  const w = width - 2 * dieLeftX - s.diceS - PAD / 2;
  const font = Math.min(s.statusFont, fitFont(STATUS_CHARS, w, STATUS_LINES), s.rowH / (1.3 * STATUS_LINES));
  return { x: width / 2, w, font, lines: STATUS_LINES };
}

// Portrait with the board in the vertical middle. Above the board, top to bottom: the title row (Restart / LUDO / Menu)
// and a row with the status line and, when the turn is a top yard's, the die at the left or the right. Below the board
// is the same amount of space, where the die stands when the turn is a bottom yard's, so the board is exactly centred.
function centredPortrait(vw, vh) {
  const width = BOARD;
  let side = 110;
  // The side height and the UI scale depend on each other (a smaller scale needs bigger controls),
  // so iterate a few times until the side height stops changing.
  for (let i = 0; i < 5; i++) {
    const s = portraitSizes(Math.min(vw / width, vh / (BOARD + 2 * side)));
    const need = s.pillH + s.rowH + PAD * 3;
    const fill = (Math.round((BOARD * vh) / vw) - BOARD) / 2; // side that would fill the screen height
    const next = Math.floor(clamp(fill, need, MAX_HUD_SPACE) / 10) * 10; // rounded down: the canvas must never be taller than the screen allows
    if (next === side) break;
    side = Math.max(next, Math.ceil(need / 10) * 10);
  }
  const height = BOARD + side * 2;
  const scale = Math.min(vw / width, vh / height);
  const s = portraitSizes(scale);

  const gap = (side - (s.pillH + s.rowH)) / 3;
  const rows = {
    y1: gap + s.pillH / 2,
    yDiceAbove: gap * 2 + s.pillH + s.rowH / 2,
    yDiceBelow: side + BOARD + gap + s.rowH / 2, // the same distance from the board as the row above it
  };
  return portraitResult({ width, height, scale, boardY: side, s, rows });
}

// Builds the layout object for a portrait screen from the pieces both portrait arrangements compute.
function portraitResult({ width, height, scale, boardY, s, rows }) {
  const { ui } = s;
  // Avatars stand at the outer edges of the rows the die uses. On a screen with no row below the board (the stacked
  // arrangement) the top-left and bottom-left avatars would be on top of each other, so there are none.
  const hasAvatars = rows.yDiceBelow !== rows.yDiceAbove;
  const nameFont = Math.min(ui(16, 10), (width / 2 - PAD * 2) / estimateTextWidth(PROFILE_NAME_CHARS, 1));
  // The avatar shrinks (never below 36 real pixels) when that is what it takes to leave room for a readable name between the
  // top avatars and the board.
  let avatarS = Math.min(s.rowH * 0.9, 84);
  const nameNeed = (9 / scale) * 1.3 + 4;
  while (hasAvatars && avatarS > 36 / scale && boardY - (rows.yDiceAbove + avatarOuterSize(avatarS) / 2 + 2) < nameNeed) avatarS -= 2;
  const outer = avatarOuterSize(avatarS);
  // Each avatar's name stands right under it. When the row is too close to the board for that (a top avatar on a medium
  // height screen), the name shrinks to the room there is, and if even that is too little it goes above the avatar instead.
  const nameAt = (right, below) => {
    const y = below ? rows.yDiceBelow : rows.yDiceAbove;
    const x = right ? width - PAD : PAD;
    const minName = 9 / scale; // 9 real pixels is the smallest name that can still be read
    const fit = (room) => Math.min(nameFont, (room - 2) / 1.3);
    const roomUnder = below ? height - (y + outer / 2 + 2) : boardY - (y + outer / 2 + 2);
    if (fit(roomUnder) >= minName) return { x, originX: right ? 1 : 0, font: fit(roomUnder), y: y + outer / 2 + 2 + fit(roomUnder) * 0.65 + 1 };
    if (!below) {
      const roomAbove = y - outer / 2 - 2 - (rows.y1 + s.pillH / 2);
      if (fit(roomAbove) >= minName) return { x, originX: right ? 1 : 0, font: fit(roomAbove), y: y - outer / 2 - 2 - fit(roomAbove) * 0.65 - 1 };
    }
    return null;
  };
  const avatar = hasAvatars ? {
    size: avatarS,
    slot: (right, below) => ({ x: right ? width - PAD - outer / 2 : PAD + outer / 2, y: below ? rows.yDiceBelow : rows.yDiceAbove }),
    nameFont,
    nameSlot: nameAt,
  } : null;
  // The die stands next to its player's avatar, AVATAR_GAP_PX (real pixels) away from it, whichever colour's turn it is.
  // Without avatars (the stacked arrangement) it stands at its yard's centre.
  const dieLeftX = hasAvatars ? PAD + outer + AVATAR_GAP_PX / scale + s.diceS / 2 : spotX(0, false);
  const status = statusBetween(s, width, dieLeftX);
  return {
    orientation: 'portrait', width, height, scale, boardX: 0, boardY, ui,
    hud: {
      title: { x: width / 2, y: rows.y1, font: s.titleFont },
      restart: { x: PAD + s.pillW / 2, y: rows.y1, w: s.pillW, h: s.pillH, font: ui(15, 11.5) },
      menu: { x: width - PAD - s.pillW / 2, y: rows.y1, w: s.pillW, h: s.pillH, font: ui(15, 11.5) },
      status: { ...status, y: rows.yDiceAbove },
      dice: { size: s.diceS },
      diceSpot: (right, below) => ({ x: right ? width - dieLeftX : dieLeftX, y: below ? rows.yDiceBelow : rows.yDiceAbove }),
      avatar,
    },
    menu: menuLayout({ landscape: false, width, height, ui }),
    settings: settingsLayout({ landscape: false, width, height, ui }),
    modal: modalLayout({ width, height, ui }),
    setup: setupLayout({ width, height, ui }),
    profile: profileLayout({ width, height, ui }),
    online: onlineLayout({ landscape: false, width, height, ui }),
  };
}

// Portrait for a screen too short to give the board equal space above and below: everything above the board, so the
// die stands in the row above the board whichever yard it belongs to.
function stackedPortrait(vw, vh) {
  const width = BOARD;
  let header = 180;
  // The header height and the UI scale depend on each other (a smaller scale needs bigger controls),
  // so iterate a few times until the header height stops changing.
  for (let i = 0; i < 5; i++) {
    const s = portraitSizes(Math.min(vw / width, vh / (BOARD + header)));
    const need = s.pillH + s.rowH + PAD * 3;
    const fill = Math.round((BOARD * vh) / vw) - BOARD; // header that would fill the screen height
    const next = quantize(clamp(fill, need, MAX_HUD_SPACE), 20);
    if (next === header) break;
    header = Math.max(next, Math.ceil(need / 20) * 20);
  }
  const height = BOARD + header;
  const scale = Math.min(vw / width, vh / height);
  const s = portraitSizes(scale);

  const gap = (header - (s.pillH + s.rowH)) / 3;
  const yDiceAbove = gap * 2 + s.pillH + s.rowH / 2;
  const rows = { y1: gap + s.pillH / 2, yDiceAbove, yDiceBelow: yDiceAbove };
  return portraitResult({ width, height, scale, boardY: header, s, rows });
}

// The board is centred when that costs nothing: when the screen is tall enough that the scale is set by the width alone.
// A short screen (such as a 320x480 phone) keeps everything above the board so the controls stay big enough.
function portraitLayout(vw, vh) {
  const centred = centredPortrait(vw, vh);
  return centred.scale >= vw / BOARD - 1e-9 ? centred : stackedPortrait(vw, vh);
}

// --- landscape -------------------------------------------------------------------------------

function landscapeLayout(vw, vh) {
  const height = BOARD;
  const width = clamp(quantize((BOARD * vw) / vh, 40), 1120, 1500);
  const scale = Math.min(vw / width, vh / height);
  const ui = makeUi(scale);
  const hudX = BOARD + PAD;
  const hw = width - BOARD - PAD * 2;

  // The HUD column beside the board, top to bottom: title, Restart / Menu, a row for the die when it belongs to a yard at
  // the top of the board, the status line, and a row for the die when it belongs to a yard at the bottom. The die
  // stands on the left or the right of its row, like its yard.
  const titleFont = ui(44, 26);
  const pillH = ui(36, PILL_MIN_H);
  const statusFont = ui(26, 15);
  const statusH = statusFont * 1.3 * 2;
  const diceS = ui(74, 42); // a little bigger than the 59 / 34 it was shrunk to (it was 96 / 56 originally)
  const content = titleFont * 1.2 + pillH + diceS + statusH + diceS;
  const gap = (height - content) / 6;

  const yTitle = gap + (titleFont * 1.2) / 2;
  const yButtons = gap * 2 + titleFont * 1.2 + pillH / 2;
  const yDiceAbove = gap * 3 + titleFont * 1.2 + pillH + diceS / 2;
  const yStatus = gap * 4 + titleFont * 1.2 + pillH + diceS + statusH / 2;
  const yDiceBelow = gap * 5 + titleFont * 1.2 + pillH + diceS + statusH + diceS / 2;
  const cx = hudX + hw / 2;
  const pillW = (hw - PAD) / 2;
  const avatarS = ui(64, 40);
  const outer = avatarOuterSize(avatarS);
  const dieLeftX = hudX + outer + AVATAR_GAP_PX / scale + diceS / 2; // AVATAR_GAP_PX (real pixels) from the avatar beside it
  const dieX = (right) => (right ? hudX + hw - (dieLeftX - hudX) : dieLeftX);
  const nameFont = Math.min(ui(15, 10), (hw / 2 - 4) / estimateTextWidth(PROFILE_NAME_CHARS, 1));

  return {
    orientation: 'landscape', width, height, scale, boardX: 0, boardY: 0, ui,
    hud: {
      title: { x: cx, y: yTitle, font: titleFont },
      restart: { x: hudX + pillW / 2, y: yButtons, w: pillW, h: pillH, font: ui(15, 11.5) },
      menu: { x: hudX + pillW * 1.5 + PAD, y: yButtons, w: pillW, h: pillH, font: ui(15, 11.5) },
      status: { x: cx, y: yStatus, w: hw, font: Math.min(statusFont, fitFont(STATUS_CHARS, hw, 2)), lines: 2 },
      dice: { size: diceS },
      diceSpot: (right, below) => ({ x: dieX(right), y: below ? yDiceBelow : yDiceAbove }),
      avatar: {
        size: avatarS,
        slot: (right, below) => ({ x: right ? hudX + hw - outer / 2 : hudX + outer / 2, y: below ? yDiceBelow : yDiceAbove }),
        nameFont,
        // The name stands right under the avatar when the screen has room for it.
        nameSlot: (right, below) => {
          const y = (below ? yDiceBelow : yDiceAbove) + outer / 2 + 4 + nameFont * 0.65;
          const fits = y + nameFont * 0.65 <= (below ? height - 2 : yStatus - statusH / 2)
          return fits ? { x: right ? hudX + hw : hudX, originX: right ? 1 : 0, y } : null;
        },
      },
    },
    menu: menuLayout({ landscape: true, width, height, ui }),
    settings: settingsLayout({ landscape: true, width, height, ui }),
    modal: modalLayout({ width, height, ui }),
    setup: setupLayout({ width, height, ui }),
    profile: profileLayout({ width, height, ui }),
    online: onlineLayout({ landscape: true, width, height, ui }),
  };
}

// --- shared, mutable current layout ----------------------------------------------------------
// Modules read `layout.<field>` at the moment they draw, so they always use the current layout.
// `apply()` recomputes it and reports whether the logical canvas size changed.
export const layout = { ...computeLayout(720, 900) };

export function applyViewport(viewportW, viewportH, allowLandscape = true) {
  const next = computeLayout(viewportW, viewportH, allowLandscape);
  const changed =
    next.width !== layout.width || next.height !== layout.height || next.orientation !== layout.orientation;
  Object.assign(layout, next);
  return changed;
}




