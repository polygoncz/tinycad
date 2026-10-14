import type { DocumentWriter } from '@/document';
import type { OpHandler, OpHandlerRegistry } from './op-handler';
import { OP_VERSION } from './operation';
import type { BatchOp, Operation, StudioSetRollbackOp } from './operation';

export interface ApplyResult {
  readonly inverse: Operation;
  /** Exceptions of document subscribers thrown AFTER the document changed. The caller throws them. */
  readonly deferred: unknown[];
}

/**
 * The one place where an operation reaches the document (spec 04): shared by the dispatcher,
 * transactions and replayLog, so validation, batch inverses, rollback bar restoring and
 * subscriber exceptions are handled the same everywhere.
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
  // Both throw straight away: nothing has changed yet.
  assertValid(handler, op);
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

/**
 * What loading refuses or changes must not be written (D1, M19.1): the current version of the
 * handler and the same validate as upcastOperation. Otherwise an operation with NaN in its params
 * or a newer version would reach the log and the document could not be opened again, and an
 * older one would be upcast on loading into something else than what was applied. Lists every
 * problem of the payload.
 */
function assertValid(handler: OpHandler, op: Operation): void {
  assertVersion(op, handler.version);
  // Operation is a plain JSON object, so viewing it as a record for validate is safe; through
  // unknown because an interface has no index signature.
  const errors = handler.validate?.(op as unknown as Readonly<Record<string, unknown>>) ?? [];
  if (errors.length === 0) return;
  const list = errors.map(({ path, message }) => `${path}: ${message}`).join('; ');
  throw new Error(`Invalid operation '${op.type}': ${list}`);
}

/** Upcast belongs to loading only: a write is always in the current version of its type. */
function assertVersion(op: Operation, version: number): void {
  if (op.v === version) return;
  throw new Error(
    `Invalid operation '${op.type}': version ${String(op.v)}, expected ${String(version)}`,
  );
}

function applyBatch(doc: DocumentWriter, handlers: OpHandlerRegistry, op: BatchOp): ApplyResult {
  // Throws straight away: nothing has changed yet.
  assertVersion(op, OP_VERSION.batch);
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
