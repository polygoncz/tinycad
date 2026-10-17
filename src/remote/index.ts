// Ring 3 – adapters of the ports over the gRPC protocol of the native core (spec 14, Q106): the
// connect-web client and the conversions between protocol messages and domain types. Only app
// imports it.
// Public API of remote. Everything else in this folder is internal.

export { createCoreTransport } from './transport';
export { createRemoteSketchGeometry } from './sketch-geometry';
