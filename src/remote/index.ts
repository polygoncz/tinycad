// Ring 3 – adapters of the ports over the gRPC protocol of the native core (spec 14, Q106): the
// connect-web client, the session and the catalog of documents, and the conversions between
// protocol messages and domain types (operations, read model, feature types). Only app imports it.
// Public API of remote. Everything else in this folder is internal.

export { createCoreTransport } from './transport';
export { createRemoteSketchGeometry } from './sketch-geometry';
export { isRetryable, RemoteError, toRemoteError } from './errors';
export type { RemoteErrorCode, RemoteErrorInit, RemoteErrorReason } from './errors';
export { operationFromProto, operationToProto } from './operations';
export { decodeReadModel } from './read-model';
export type {
  AnchorData,
  AxisData,
  BodyData,
  FeatureAnchors,
  FeatureErrorData,
  FeatureStatusData,
  HistoryData,
  LogEntryData,
  PlaneData,
  ReadModelData,
  SketchViewData,
  StateData,
} from './read-model';
export { featureSchemaOf, visibleWhenOf } from './feature-types';
export { openRemoteSession } from './session';
export type {
  ChangeOutcome,
  ChangeRequest,
  ConnectionState,
  ReadOptions,
  RemoteSession,
  RemoteSessionEvents,
  RemoteSessionOptions,
  RetryPolicy,
  SessionResumeStore,
  Timers,
} from './session';
export { createRemoteDocuments } from './documents';
export type { RemoteDocuments, RemoteDocumentSummary } from './documents';
