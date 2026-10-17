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
