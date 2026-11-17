// Minimal stand-in for Phaser so modules that import it can be loaded in Node during tests.
// Only what is touched at import time needs to exist.
export default {
  AUTO: 0,
  Scene: class {},
  Scale: { FIT: 0, CENTER_BOTH: 0 },
  Events: { EventEmitter: class {} },
  GameObjects: { Container: class {}, BitmapText: class {} },
  Math: { Between: () => 0 },
};
