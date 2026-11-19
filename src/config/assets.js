import computerUrl from '../../img/buttons/player-vs-computer-button.png';
import friendsUrl from '../../img/buttons/with-friends-button.png';
import localUrl from '../../img/buttons/local-multiplayer-button.png';
import onlineUrl from '../../img/buttons/play-online-button.png';
import menuButtonUrl from '../../img/buttons/menu-button-small.png'; // 256 px copies of menu-button.png and restart-button.png (tools/shrinkImage.mjs)
import restartButtonUrl from '../../img/buttons/restart-button-small.png';
import backButtonUrl from '../../img/buttons/back-button-small.png'; // 640 px copies of back-button.png, cancel-button.png and reset-button.png
import cancelButtonUrl from '../../img/buttons/cancel-button-small.png';
import resetButtonUrl from '../../img/buttons/reset-button-small.png';
import settingsUrl from '../../img/buttons/setting-button-small.png'; // a 320 px copy of setting-button.png (tools/shrinkImage.mjs)
import backgroundUrl from '../../img/elements/bg-small.png';
import boardUrl from '../../img/elements/board.png';
import setupPopupUrl from '../../img/elements/setup-popup.png';
import diceUrl from '../../img/elements/dice.png';
import boardBottomUrl from '../../img/elements/board-bottom.png';
import boardTopUrl from '../../img/elements/board-top.png';
import blueTokenUrl from '../../img/elements/token-blue.png';
import greenTokenUrl from '../../img/elements/token-green.png';
import redTokenUrl from '../../img/elements/token-red.png';
import yellowTokenUrl from '../../img/elements/token-yellow.png';
import largeFontPng from '../../img/spritefont/font-lg.png';
import largeFontXml from '../../img/spritefont/font-lg.xml?url';
import smallFontPng from '../../img/spritefont/font-sm.png';
import smallFontXml from '../../img/spritefont/font-sm.xml?url';

// Vite gives each file a URL that works in development and in the built game (relative to the page, so the game
// can be hosted in any folder).

// The avatars: every picture in img/avatars-small/ (small copies made by tools/shrinkAvatars.mjs from img/avatars/).
// A picture added to that folder becomes one more avatar, with no change to the code. Sorted by name so every device
// lists them in the same order.
const avatarFiles = import.meta.glob('../../img/avatars-small/*.png', { eager: true, query: '?url', import: 'default' });
export const AVATARS = Object.entries(avatarFiles)
  .map(([path, url]) => ({ key: `avatar-${path.split('/').pop().replace(/\.png$/i, '').toLowerCase()}`, url }))
  .sort((a, b) => a.key.localeCompare(b.key));
export const AVATAR_KEYS = AVATARS.map((a) => a.key);

// The pictures on the splash-page buttons.
export const MENU_BUTTON_IMAGES = [
  { key: 'btn-computer', url: computerUrl },
  { key: 'btn-local', url: localUrl },
  { key: 'btn-online', url: onlineUrl },
  { key: 'btn-friends', url: friendsUrl },
  { key: 'btn-settings', url: settingsUrl },
  { key: 'btn-menu', url: menuButtonUrl }, // the Menu and Restart buttons of the game screen
  { key: 'btn-restart', url: restartButtonUrl },
  { key: 'btn-back', url: backButtonUrl }, // the Back, Cancel and Reset defaults buttons (see BUTTON_PICTURES)
  { key: 'btn-cancel', url: cancelButtonUrl },
  { key: 'btn-reset', url: resetButtonUrl },
];

// A text button whose label is one of these shows the picture instead (the label, lower-cased, is the key).
export const BUTTON_PICTURES = { back: 'btn-back', cancel: 'btn-cancel', 'reset defaults': 'btn-reset' };

// The board, the four pieces and the wooden background (img/elements, made by tools/buildElements.mjs). If one is missing the
// game falls back to drawing it with shapes.
export const BOARD_IMAGE = 'board-img';
export const BACKGROUND_IMAGE = 'bg-img';
export const BOARD_TOP_IMAGE = 'board-top'; // the water of the board artwork above and below the board
export const BOARD_BOTTOM_IMAGE = 'board-bottom';
// The six faces of the die: one picture of 3 x 2 cells, the cells numbered from 0 (face 1 is frame 0, face 6 is frame 5).
export const DICE_SHEET = { key: 'dice-faces', url: diceUrl, frameWidth: 128, frameHeight: 128 };
export const SETUP_POPUP_IMAGE = 'setup-popup'; // the "how many players?" popup of Player vs Computer (src/config/setupPopup.js)
export const tokenImageKey = (colorId) => `token-${colorId}`;
export const ELEMENT_IMAGES = [
  { key: BOARD_IMAGE, url: boardUrl },
  { key: BACKGROUND_IMAGE, url: backgroundUrl },
  { key: SETUP_POPUP_IMAGE, url: setupPopupUrl },
  { key: BOARD_TOP_IMAGE, url: boardTopUrl },
  { key: BOARD_BOTTOM_IMAGE, url: boardBottomUrl },
  { key: tokenImageKey('red'), url: redTokenUrl },
  { key: tokenImageKey('green'), url: greenTokenUrl },
  { key: tokenImageKey('yellow'), url: yellowTokenUrl },
  { key: tokenImageKey('blue'), url: blueTokenUrl },
];

// The picture font, in two sizes (made from img/spritefont/spritefont-sheet-1.png by tools/buildSpriteFont.mjs).
export const FONT_LARGE = 'font-lg';
export const FONT_SMALL = 'font-sm';
export const SPRITE_FONTS = [
  { key: FONT_LARGE, png: largeFontPng, xml: largeFontXml },
  { key: FONT_SMALL, png: smallFontPng, xml: smallFontXml },
];
