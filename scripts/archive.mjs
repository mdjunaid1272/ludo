// Builds a clean source archive: archives/ludo-<timestamp>.zip
//
// Uses an allow-list of what belongs in a source archive (never node_modules or dist), then lists the
// finished archive and fails if anything it should not contain slipped in.
// Needs `tar` with zip support (Windows 10+ and macOS) or the `zip` command (Linux).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const INCLUDE = [
  'src', 'server', 'tests', 'docs', 'scripts', 'tools', 'img',
  'index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'eslint.config.js',
  '.gitignore', '.nvmrc', 'README.md',
];
// Junk that file sync tools and operating systems scatter through folders (Google Drive adds desktop.ini to every folder).
const JUNK = ['desktop.ini', 'Thumbs.db', '.DS_Store'];
const FORBIDDEN = [/(^|\/)node_modules(\/|$)/, /(^|\/)dist(\/|$)/, /(^|\/)archives(\/|$)/, /\.zip$/i, /desktop\.ini$/i];

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = 'archives';
const out = join(outDir, `ludo-${stamp}.zip`);
const files = INCLUDE.filter((f) => existsSync(f));

mkdirSync(outDir, { recursive: true });
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let made = run('tar', ['-a', '-c', '-f', out, ...JUNK.map((j) => `--exclude=${j}`), ...files]);
let list = made.status === 0 ? run('tar', ['-t', '-f', out]) : null;
if (!list || list.status !== 0) {
  // Fallback for systems whose tar cannot write zip files.
  made = run('zip', ['-r', '-q', out, ...files, '-x', ...JUNK.map((j) => `*${j}`)]);
  if (made.status !== 0) {
    console.error('Could not create the archive: neither "tar -a" nor "zip" worked.\n' + (made.stderr || ''));
    process.exit(1);
  }
  list = run('unzip', ['-Z1', out]);
}

const entries = list.stdout.split(/\r?\n/).filter(Boolean);
const bad = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
if (bad.length) {
  rmSync(out, { force: true }); // never leave a bad archive behind
  console.error(`Archive contains files that should not be shipped, e.g. ${bad.slice(0, 5).join(', ')}`);
  process.exit(1);
}
console.log(`${out}: ${entries.length} entries, ${(statSync(out).size / 1024).toFixed(0)} KB, no node_modules or dist.`);

