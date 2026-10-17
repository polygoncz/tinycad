import { spawnSync } from 'node:child_process';

// After the e2e run (playwright.config.ts): removes the Compose project with its tmpfs documents
// (scripts/e2e-core.mjs down). E2E_KEEP_CORE=1 leaves it running, to look at it after a failure.

export default function globalTeardown(): void {
  if (process.env.E2E_KEEP_CORE === '1') return;
  spawnSync('node', ['scripts/e2e-core.mjs', 'down'], { stdio: 'inherit' });
}
