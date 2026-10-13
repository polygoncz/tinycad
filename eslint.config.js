// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Rings 1 and 2 (ADR 0009). Mirrors the include list of tsconfig.domain.json.
const platformIndependent = [
  'src/core/**/*.ts',
  'src/document/**/*.ts',
  'src/ops/**/*.ts',
  'src/persistence/**/*.ts',
  'src/kernel/**/*.ts',
  'src/regen/**/*.ts',
  'src/plugin-api/**/*.ts',
  'src/features/**/*.ts',
  'src/interaction/**/*.ts',
];

// Second safety net next to the DOM-free tsconfig: these globals exist in
// browser or Node typings that a test or a stray /// <reference> could pull in.
const platformGlobals = [
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'Worker',
  'process',
  'Buffer',
  'global',
].map((name) => ({
  name,
  message: 'Domain and presentation logic must stay platform independent (ADR 0009).',
}));

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'docs/', 'scripts/', 'node_modules/'] },

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  vue.configs['flat/recommended'],

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    // Plain JS tooling files are not part of any tsconfig project.
    files: ['**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: platformIndependent,
    ignores: ['src/persistence/idb/**', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...platformGlobals],
    },
  },

  // Must be last: turns off stylistic rules that Prettier owns.
  prettier,
);
