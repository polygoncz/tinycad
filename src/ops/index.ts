// Ring 1 – operations, dispatcher, operation log, transactions, undo/redo.
// Public API of ops (spec 04). Everything else in this folder is internal.

export type {
  BatchOp,
  BodyRenameOp,
  BodySetVisibleOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  Operation,
  StudioSetRollbackOp,
} from './operation';
export { OP_VERSION } from './operation';
export { createOpHandlerRegistry } from './handler';
export type { OpHandler, OpHandlerRegistry } from './handler';
export { createOperationLog } from './log';
export type { LogEntry, OperationLog, OperationLogReader } from './log';
export { replayLog } from './replay';
export { createOperationDispatcher } from './dispatcher';
export type { DispatchMeta, OperationDispatcher } from './dispatcher';
export type { Transaction } from './transaction';
export { createUndoManager, rebuildUndoStacks } from './undo';
export type { UndoManager } from './undo';
export { upcastOperation } from './upcast';
export { parseLogEntry } from './parse-entry';
export type { OperationLoadError } from './load-error';
