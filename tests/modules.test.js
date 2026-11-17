import { describe, it, expect } from 'vitest';

// "vite build" tree-shakes unused code, so it cannot catch a module that throws when loaded
// (for example a leftover reference to a removed import). Loading every module here does.
// Phaser is replaced by tests/stubs/phaser.js (see the alias in vite.config.js).
const modules = import.meta.glob('../src/**/*.js');
const IGNORED = ['../src/main.js']; // creates the Phaser game on import

describe('every source module loads', () => {
  for (const [path, load] of Object.entries(modules)) {
    if (IGNORED.includes(path)) continue;
    it(path.replace('../src/', ''), { timeout: 30000 }, async () => {
      await expect(load()).resolves.toBeDefined();
    });
  }
});

