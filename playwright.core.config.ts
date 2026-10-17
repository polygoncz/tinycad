import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

// E2E through the native core (M39, N3): the app built with VITE_CORE_URL=/api, so the sketcher's
// 2D geometry goes over GeometryService instead of the WASM kernel. The `vite preview` server
// forwards /api to Envoy of docker-compose.yml (vite.config.ts server.proxy, which preview reuses),
// so Compose must be up: `npm run test:e2e:core` starts it. Only the specs that need the core run
// (m39), only in Chrome; the default config skips them (E2E_CORE unset).
// A port and a build directory of its own, so this run never meets the default e2e run.
const PORT = Number(process.env.E2E_CORE_PORT ?? 4183);
const BASE_URL = `http://localhost:${String(PORT)}`;
const OUT_DIR = 'dist-core';

// The specs ask for E2E_CORE (test.skip without it); the workers inherit the env of the runner.
process.env.E2E_CORE = '1';

export default defineConfig({
  ...base,
  testMatch: 'm39.spec.ts',
  outputDir: `test-results/${String(PORT)}`,
  use: { ...base.use, baseURL: BASE_URL },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
  webServer: {
    command:
      `npm run typecheck && VITE_CORE_URL=/api npx vite build --outDir ${OUT_DIR} && ` +
      `npx vite preview --outDir ${OUT_DIR} --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
