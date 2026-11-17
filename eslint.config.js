import js from '@eslint/js';
import globals from 'globals';

// Catches mistakes that tests and "vite build" can miss, such as an undefined name inside a
// function that no test happens to run, or an import that is no longer used.
export default [
  { ignores: ['dist/', 'node_modules/', 'archives/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/**/*.js', 'tools/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['tests/**/*.js', 'scripts/**/*.{js,mjs}', 'server/**/*.js', '*.config.js', 'tools/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
];
