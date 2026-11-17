import { gameAreaFor } from '../config/layout.js';

// Reads the browser window and returns the area the game gets (see gameAreaFor). On a desktop page it also sizes
// the game's container to that area, so the 9:16 box is centred and the page's gradient shows around it; on a
// phone or tablet the container keeps filling the screen.
export function readGameArea() {
  const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const area = gameAreaFor(window.innerWidth, window.innerHeight, isTouch);
  const container = document.getElementById('game');
  if (container) {
    container.style.width = isTouch ? '' : `${area.w}px`;
    container.style.height = isTouch ? '' : `${area.h}px`;
  }
  return area;
}
