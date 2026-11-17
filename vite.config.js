import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The dev server answers /config.js too (the build copies it to dist/config.js, see tools/copyConfig.mjs).
const serveConfig = () => ({
  name: 'serve-config',
  configureServer: (server) => {
    server.middlewares.use('/config.js', (_req, res) => {
      res.setHeader('content-type', 'text/javascript');
      res.end(readFileSync(new URL('./deploy/config.js', import.meta.url)));
    });
  },
});

export default defineConfig({
  plugins: [serveConfig()],
  // Relative URLs, so the built game works from any folder, static host or file-based wrapper.
  base: './',
  server: { host: true, port: 5173 },
  build: {
    // Phaser alone is about 1.3 MB minified, so the default 500 kB warning would always fire.
    chunkSizeWarningLimit: 1500,
    // Phaser changes rarely: its own chunk stays cached while the game code changes.
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Some tests play whole games (with packet loss, or over real sockets); on a slow or busy machine they
    // can take several seconds, which is not a failure.
    testTimeout: 30_000,
    // Phaser needs a browser; tests load modules against a small stub instead.
    alias: { phaser: fileURLToPath(new URL('./tests/stubs/phaser.js', import.meta.url)) },
  },
});

