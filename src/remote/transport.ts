// The connection to the native core (spec 14 "Přehled", ADR 0030): gRPC-Web through Envoy, which
// translates it to gRPC for tinycad-core.

import type { Transport } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';

/**
 * A request header a call of remote sets to have its fetch sent with `keepalive` (CloseSession on
 * pagehide, N70): connect-web has no option of a call for it. The transport removes the header,
 * so it never leaves the browser.
 */
export const KEEPALIVE_HEADER = 'tinycad-keepalive';

/**
 * A gRPC-Web transport to the core at `baseUrl` (VITE_CORE_URL: '/api' through the Vite proxy in
 * development, or the full URL of Envoy). Binary protobuf, as Envoy's grpc_web filter expects.
 */
export function createCoreTransport(baseUrl: string): Transport {
  return createGrpcWebTransport({ baseUrl, fetch: keepaliveFetch });
}

/** globalThis.fetch (looked up at every call), with keepalive for a call with KEEPALIVE_HEADER. */
function keepaliveFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has(KEEPALIVE_HEADER)) return globalThis.fetch(input, init);
  headers.delete(KEEPALIVE_HEADER);
  return globalThis.fetch(input, { ...init, headers, keepalive: true });
}
