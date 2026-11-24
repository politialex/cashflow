import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['*.js', 'scripts/*.js', 'test/*.js'], languageOptions: { globals: globals.node } },
];
