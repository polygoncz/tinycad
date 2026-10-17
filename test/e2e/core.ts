import { spawn } from 'node:child_process';
import { createClient } from '@connectrpc/connect';
import type { Client } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { DocumentService } from '@/protocol';

// The core of the e2e run, seen from Node (N72): Envoy of docker-compose.e2e.yml on localhost at
// E2E_CORE_PORT (playwright.config.ts sets the default; the workers inherit it). gRPC-Web with
// the global fetch of Node, the same protocol as the browser.

/** The base URL of Envoy of this run. */
export function coreUrl(): string {
  return `http://localhost:${process.env.E2E_CORE_PORT ?? '18080'}`;
}

/** A client of DocumentService of the core of this run. */
export function documentService(): Client<typeof DocumentService> {
  return createClient(DocumentService, createGrpcWebTransport({ baseUrl: coreUrl() }));
}

const RESTART_TIMEOUT_MS = 60_000;

/**
 * Restarts the core of this run (scripts/e2e-core.mjs restart): every session on it ends, the
 * documents stay. Resolves once a call reaches the new process. Asynchronous, so a test can watch
 * the page meanwhile. Only for the serial project `restart` of playwright.config.ts: other tests
 * would lose their sessions.
 */
export async function restartCore(): Promise<void> {
  const status = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('node', ['scripts/e2e-core.mjs', 'restart'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (status !== 0) throw new Error('The core of the e2e run did not restart (see above)');
  const documents = documentService();
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
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
