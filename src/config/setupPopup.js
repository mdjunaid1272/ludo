// The pictures of the "How many players?" popups, one per game mode (img/UI boards), as made by tools/buildElements.mjs into
// img/elements/<name>: the artwork cut to `crop` (pixels of the original) and scaled to MADE_WIDTH wide. The title, the question and the
// three count buttons are part of each picture, so the game only lays invisible tap areas over the buttons.
// Modes without a picture here (Play Online, which has no count step) use the drawn panel.
export const POPUP_MADE_WIDTH = 1000;

// `buttons` is where the three buttons are in the original picture: their common middle (y), their size and the centre (x) of each.
// `body` is the width, in original pixels, of the board itself (without the crown, the leaves and the shadow): the game draws that as wide
// as its ordinary panel.
function popup({ file, name, crop, body, buttons }) {
  const scale = POPUP_MADE_WIDTH / crop.w;
  return {
    source: `../UI boards/${file}`, // from img/elements
    name, // the made file, in img/elements
    crop,
    height: Math.round(crop.h * scale),
    bodyWidth: Math.round(body * scale),
    // the buttons, in made-picture pixels from the picture's top left corner: { x, y } is the centre
    buttons: Object.fromEntries(
      Object.entries(buttons.x).map(([n, x]) => [n, { x: (x - crop.x) * scale, y: (buttons.y - crop.y) * scale, w: buttons.w * scale, h: buttons.h * scale }]),
    ),
  };
}

export const POPUPS = {
  computer: popup({
    file: 'Player Count Selection Popup.png', // 1549 x 1015
    name: 'setup-popup.png',
    crop: { x: 80, y: 0, w: 1390, h: 895 },
    body: 1355,
    buttons: { y: 512, w: 315, h: 218, x: { 2: 434, 3: 776, 4: 1118 } },
  }),
  local: popup({
    file: 'Local Multiplayer Game Panel.png', // 1606 x 979
    name: 'setup-popup-local.png',
    crop: { x: 70, y: 0, w: 1470, h: 950 },
    body: 1405,
    buttons: { y: 558, w: 370, h: 240, x: { 2: 410, 3: 803, 4: 1199 } },
  }),
};
