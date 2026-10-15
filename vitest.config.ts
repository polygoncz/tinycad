import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            // Unit tests mirror src/ in test/unit/ (ADR 0023) and run in Node.
            include: ['test/unit/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            // Slow tests with real adapters (OCCT WASM, …).
            include: ['test/integration/**/*.test.ts'],
            environment: 'node',
          },
        },
      ],
    },
  }),
);
