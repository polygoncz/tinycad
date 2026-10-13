import type { DocumentWriter } from '@/document';
import type { OpHandlerRegistry } from './op-handler';
import { OP_VERSION } from './operation';
import type { BatchOp, Operation, StudioSetRollbackOp } from './operation';

export interface ApplyResult {
  readonly inverse: Operation;
  /** Exceptions of document subscribers thrown AFTER the document changed. The caller throws them. */
  readonly deferred: unknown[];
}

/**
 * The one place where an operation reaches the document (spec 04): shared by the dispatcher,
 * transactions and replayLog, so batch inverses, rollback bar restoring and subscriber
 * exceptions are handled the same everywhere.
 */
export function applyOperation(
  doc: DocumentWriter,
  handlers: OpHandlerRegistry,
  op: Operation,
): ApplyResult {
  return op.type === 'batch'
    ? applyBatch(doc, handlers, op as BatchOp) // 'batch' is a structural op, discriminated by type
    : applySingle(doc, handlers, op);
}

function applySingle(doc: DocumentWriter, handlers: OpHandlerRegistry, op: Operation): ApplyResult {
  const handler = handlers.get(op.type);
  // Throws straight away: nothing has changed yet.
  const handlerInverse = handler.invert(doc, op);

  const barBefore = doc.studio.rollbackIndex;
  const orderBefore = doc.studio.features.map((f) => f.id);
  const studioBefore = doc.studio;
  const metaBefore = doc.meta;
  const deferred: unknown[] = [];
  try {
    handler.apply(doc, op);
  } catch (e) {
    // Unchanged document = the handler failed. Changed = a `changed` subscriber threw
    // after the mutation, so the operation holds (Q030).
    if (doc.studio === studioBefore && doc.meta === metaBefore) throw e;
    deferred.push(e);
  }

  // Structural change (count or order of features) counts too: the handler's inverse may shift
  // the bar even when the forward change did not.
  const orderAfter = doc.studio.features.map((f) => f.id);
  const structureChanged =
    orderAfter.length !== orderBefore.length || orderAfter.some((fid, i) => fid !== orderBefore[i]);
  const barMoved = doc.studio.rollbackIndex !== barBefore;
  if (op.type === 'studio.setRollback' || !(barMoved || structureChanged)) {
    return { inverse: handlerInverse, deferred };
  }

  // Mutators shift the bar by rules that are not exactly invertible (Q029): restore it explicitly.
  const restoreBar: StudioSetRollbackOp = {
    type: 'studio.setRollback',
    v: OP_VERSION['studio.setRollback'],
    index: barBefore,
  };
  const inverse: BatchOp = {
    type: 'batch',
    v: OP_VERSION.batch,
    ops: [handlerInverse, restoreBar],
  };
  return { inverse, deferred };
}

function applyBatch(doc: DocumentWriter, handlers: OpHandlerRegistry, op: BatchOp): ApplyResult {
  const inverses: Operation[] = [];
  const deferred: unknown[] = [];
  for (const sub of op.ops) {
    let result: ApplyResult;
    try {
      result = applyOperation(doc, handlers, sub);
    } catch (original) {
      throw undoApplied(doc, handlers, inverses, original, deferred);
    }
    inverses.push(result.inverse);
    deferred.push(...result.deferred);
  }
  const inverse: BatchOp = { type: 'batch', v: OP_VERSION.batch, ops: inverses.reverse() };
  return { inverse, deferred };
}

/** Reverts already applied sub-operations; returns what the batch should throw. */
function undoApplied(
  doc: DocumentWriter,
  handlers: OpHandlerRegistry,
  inverses: readonly Operation[],
  original: unknown,
  earlierDeferred: readonly unknown[],
): unknown {
  const revertErrors: unknown[] = [];
  for (const inverse of [...inverses].reverse()) {
    try {
      revertErrors.push(...applyOperation(doc, handlers, inverse).deferred);
    } catch (e) {
      revertErrors.push(e);
    }
  }
  if (earlierDeferred.length === 0 && revertErrors.length === 0) return original;
  return new AggregateError(
    [original, ...earlierDeferred, ...revertErrors],
    'Batch failed; some errors followed while reverting it',
  );
}
