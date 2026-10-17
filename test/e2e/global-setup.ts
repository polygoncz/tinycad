import { spawnSync } from 'node:child_process';
import { documentService } from './core';

// Before the e2e run (playwright.config.ts): builds and starts the core of this checkout
// (scripts/e2e-core.mjs up, docker-compose.e2e.yml, N72), then waits until a call reaches it:
// Envoy is ready before its health check has seen the core.

const READY_TIMEOUT_MS = 30_000;

export default async function globalSetup(): Promise<void> {
  const up = spawnSync('node', ['scripts/e2e-core.mjs', 'up'], { stdio: 'inherit' });
  if (up.status !== 0) throw new Error('The core of the e2e run did not start (see above)');
  const documents = documentService();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      await documents.listDocuments({});
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
