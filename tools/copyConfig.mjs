// After the build: puts the editable server address file next to index.html (dist/config.js). It is copied by this
// script, not by Vite's public folder, so the build never depends on stray files in a synced folder.
import { copyFileSync } from 'node:fs';

copyFileSync(new URL('../deploy/config.js', import.meta.url), new URL('../dist/config.js', import.meta.url));
console.log('dist/config.js written');
