import { applyViewport, layout } from '../config/layout.js';

// Keeps the layout in step with the browser window. When the logical canvas size has to change
// (rotating the phone, a big window resize) the canvas is resized and the active scenes are
// rebuilt; a game in progress is carried over via the scene's getRestartData().
// Small resizes that do not change the layout cost nothing.
export function watchViewport(game, { debounceMs = 200, getSize = () => ({ w: window.innerWidth, h: window.innerHeight }) } = {}) {
  let timer = null;

  const refresh = () => {
    const { w, h, allowLandscape = true } = getSize();
    game.scale.refresh?.(); // the container may have been resized by getSize(): fit the canvas into it again
    if (!applyViewport(w, h, allowLandscape)) return;
    game.scale.setGameSize(layout.width, layout.height);
    for (const scene of game.scene.getScenes(true)) {
      scene.scene.restart(scene.getRestartData?.());
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
  };
}
