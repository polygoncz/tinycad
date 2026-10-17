// Ring 1 – the types of the operations and the ports of dispatching, transactions and undo.
// Public API of ops (spec 04, N163). Everything else in this folder is internal; the double of
// the ports (FakeOps) is in ops/testing.ts.

export type {
  BatchOp,
  BodyRenameOp,
  BodySetColorOp,
  BodySetMaterialOp,
  BodySetVisibleOp,
  DocumentRenameOp,
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
export type { DispatchMeta, OperationDispatcher, Transaction, UndoManager } from './ports';
