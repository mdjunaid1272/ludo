import computerUrl from '../../img/buttons/player-vs-computer-button.png';
import friendsUrl from '../../img/buttons/with-friends-button.png';
import localUrl from '../../img/buttons/local-multiplayer-button.png';
import onlineUrl from '../../img/buttons/play-online-button.png';
import settingsUrl from '../../img/buttons/setting-button-small.png'; // a 320 px copy of setting-button.png (tools/shrinkImage.mjs)
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
];

// The picture font, in two sizes (made from img/spritefont/spritefont-sheet-1.png by tools/buildSpriteFont.mjs).
export const FONT_LARGE = 'font-lg';
export const FONT_SMALL = 'font-sm';
export const SPRITE_FONTS = [
  { key: FONT_LARGE, png: largeFontPng, xml: largeFontXml },
  { key: FONT_SMALL, png: smallFontPng, xml: smallFontXml },
];
