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
            // Unit tests live next to the code (foo.ts + foo.test.ts) and run in Node.
            include: ['src/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            // Slow tests with real adapters (OCCT WASM, …).
            include: ['tests/**/*.test.ts'],
            environment: 'node',
          },
        },
      ],
    },
  }),
);
