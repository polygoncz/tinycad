// The connection to the native core (spec 14 "Přehled", ADR 0030): gRPC-Web through Envoy, which
// translates it to gRPC for tinycad-core.

import type { Transport } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';

/**
 * A gRPC-Web transport to the core at `baseUrl` (VITE_CORE_URL: '/api' through the Vite proxy in
 * development, or the full URL of Envoy). Binary protobuf, as Envoy's grpc_web filter expects.
 */
export function createCoreTransport(baseUrl: string): Transport {
  return createGrpcWebTransport({ baseUrl });
}
