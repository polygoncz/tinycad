import { defineConfig } from '@playwright/test';

// E2E against the native core (M46, N68, N72): the production build served by `vite preview`,
// driven in the installed Google Chrome and in Playwright's WebKit (Safari; spec 13). The preview
// server forwards /api to Envoy of docker-compose.yml's e2e twin, docker-compose.e2e.yml, which
// global-setup.ts starts as the Compose project tinycad-e2e-<E2E_PORT> with documents in a tmpfs
// and global-teardown.ts removes. Workers share the core, so every test works in a document of
// its own (helpers createDocument).
// E2E_PORT: the port of `vite preview`, a separate one per worktree, so parallel runs never reach
// each other's server; E2E_CORE_PORT: the port of Envoy (default 18080), likewise.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${String(PORT)}`;
process.env.E2E_CORE_PORT ??= '18080';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // Tests in one file run in order; files run in parallel. Every test has its own browser
  // context and its own document on the core. E2E_WORKERS overrides the default.
  workers: Number(process.env.E2E_WORKERS ?? 4),
  // Per port too, so two runs in one checkout never delete each other's traces.
  outputDir: `test-results/${String(PORT)}`,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  globalSetup: './test/e2e/global-setup.ts',
  globalTeardown: './test/e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    // The UI picks its language from navigator.language (ui/i18n pickLocale); the tests
    // look for the Czech texts.
    locale: 'cs-CZ',
    trace: 'retain-on-failure',
  },
  // `npm run test:e2e` runs only chrome (day-to-day work); `npm run test:e2e:full` runs both,
  // when a milestone or a track is closed.
  projects: [
    // The installed Google Chrome, no downloaded Chromium.
    { name: 'chrome', use: { channel: 'chrome' } },
    // WebKit downloaded by `npx playwright install webkit`.
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    // vite.config.ts points the proxy of /api at E2E_CORE_PORT (inherited from this process).
    command: `npm run build && npx vite preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    // typecheck + vite build before the server starts.
    timeout: 300_000,
  },
});
