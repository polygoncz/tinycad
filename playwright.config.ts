import { defineConfig } from '@playwright/test';

// E2E smoke test (M10, Ú11): the production build served by `vite preview`, driven in the
// installed Google Chrome and in Playwright's WebKit (Safari; spec 13, M10 Ú13). Every test gets a
// fresh browser context, so IndexedDB and localStorage start empty.
const PORT = 4173;
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: 'e2e',
  // The OCCT WASM takes a few seconds to load and compile in every new page.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    // The UI picks its language from navigator.language (ui/i18n pickLocale); the tests
    // look for the Czech texts.
    locale: 'cs-CZ',
    trace: 'retain-on-failure',
  },
  projects: [
    // The installed Google Chrome, no downloaded Chromium.
    { name: 'chrome', use: { channel: 'chrome' } },
    // WebKit downloaded by `npx playwright install webkit`.
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    // typecheck + vite build before the server starts.
    timeout: 300_000,
  },
});
