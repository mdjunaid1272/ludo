import { BACKGROUND_IMAGE } from '../config/assets.js';
import { layout } from '../config/layout.js';

// The wooden background behind a screen: the picture covers the whole canvas, with a dark layer over it so text and the
// board stay easy to read. Without the picture (it did not load) the plain dark background shows instead.
// Placed far below everything else; returns the objects so a scene can remove them.
export function addBackground(scene, { dim = 0.45 } = {}) {
  if (!scene.textures?.exists?.(BACKGROUND_IMAGE)) return [];
  const image = scene.add.image(layout.width / 2, layout.height / 2, BACKGROUND_IMAGE).setDepth(-1000);
  image.setScale(Math.max(layout.width / image.width, layout.height / image.height));
  const shade = scene.add.rectangle(layout.width / 2, layout.height / 2, layout.width, layout.height, 0x120a05, dim).setDepth(-999);
  return [image, shade];
}
