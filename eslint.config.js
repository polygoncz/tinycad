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
  'src/sketch/**/*.ts',
  'src/regen/**/*.ts',
  'src/plugin-api/**/*.ts',
  'src/features/**/*.ts',
  'src/interaction/**/*.ts',
  'src/sketcher/**/*.ts',
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
  {
    ignores: [
      'dist/',
      'coverage/',
      'docs/',
      'scripts/',
      'spikes/',
      'node_modules/',
      '.claude/worktrees/',
      // Claude Code mods: typed against the engine API, checked with `claude plugin validate`.
      '.claude/skills/',
    ],
  },

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
    rules: {
      // TypeScript checks undefined names; no-undef does not know browser globals in SFCs
      // (typescript-eslint recommends turning it off for TS code).
      'no-undef': 'off',
      // Timeline, Browser (Prohlížeč) and Toolbar are names from the vault (glossary, spec 11),
      // kept on purpose.
      'vue/multi-word-component-names': ['error', { ignores: ['Timeline', 'Browser', 'Toolbar'] }],
    },
  },
  {
    files: platformIndependent,
    ignores: ['src/persistence/idb/**'],
    rules: {
      'no-restricted-globals': ['error', ...platformGlobals],
    },
  },

  {
    // ADR 0011: a module's public API is interfaces, data types and factory
    // functions. core keeps its small utility classes (Emitter, …) as an exception.
    // Re-exports (`export { Foo } from './foo'`) are not detected here; the
    // architecture-reviewer subagent covers them.
    files: ['src/*/index.ts', 'src/features/*/index.ts', 'src/persistence/idb/index.ts'],
    ignores: ['src/core/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ExportNamedDeclaration > ClassDeclaration, ExportDefaultDeclaration > ClassDeclaration',
          message:
            'Do not export classes from a module API. Export an interface and a createXxx() factory (ADR 0011).',
        },
      ],
    },
  },

  // Must be last: turns off stylistic rules that Prettier owns.
  prettier,
);
