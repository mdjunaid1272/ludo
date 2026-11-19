// The picture of the "Player vs Computer / How many players?" popup (img/UI boards/Player Count Selection Popup.png), as made by
// tools/buildElements.mjs into img/elements/setup-popup.png: the artwork cut to CROP (pixels of the original, 1549 x 1015) and scaled to
// MADE_WIDTH wide. The title, the question and the three count buttons are part of the picture, so the game only lays invisible tap
// areas over the buttons.
export const POPUP_SOURCE = '../UI boards/Player Count Selection Popup.png';
export const POPUP_CROP = { x: 80, y: 0, w: 1390, h: 895 };
export const POPUP_MADE_WIDTH = 1000;
const SCALE = POPUP_MADE_WIDTH / POPUP_CROP.w;

// Where the three buttons are in the original picture: their centres (x), their common middle (y) and size.
const SOURCE_BUTTONS = { y: 512, w: 315, h: 218, x: { 2: 434, 3: 776, 4: 1118 } };

// The popup's picture in made-picture pixels.
export const POPUP_HEIGHT = Math.round(POPUP_CROP.h * SCALE);
// The board itself (without the crown, the leaves and the shadow) is 1355 original pixels wide; the game draws it as wide as its
// ordinary panel, so the picture is drawn at BODY_SOURCE_WIDTH / the panel's width.
export const POPUP_BODY_WIDTH = Math.round(1355 * SCALE);
// The buttons, in made-picture pixels from the picture's top left corner: { x, y } is the centre.
export const POPUP_BUTTONS = Object.fromEntries(
  Object.entries(SOURCE_BUTTONS.x).map(([n, x]) => [n, { x: (x - POPUP_CROP.x) * SCALE, y: (SOURCE_BUTTONS.y - POPUP_CROP.y) * SCALE, w: SOURCE_BUTTONS.w * SCALE, h: SOURCE_BUTTONS.h * SCALE }]),
);
