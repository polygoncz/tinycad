import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { OperationLoadError } from './load-error';
import type { OpHandler, OpHandlerRegistry } from './op-handler';
import { OP_VERSION } from './operation';
import type { Operation } from './operation';

const fail = (path: string, message: string): Result<Operation, OperationLoadError> =>
  err({ path, message });

/**
 * Raw data from outside -> operation of the current version. Checks the envelope, upcasts an
 * older version and then lets the handler validate the payload shape (Q032), first problem wins.
 * A migration returning a wrong version throws.
 */
export function upcastOperation(
  handlers: OpHandlerRegistry,
  raw: unknown,
): Result<Operation, OperationLoadError> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('', 'Must be an object');
  }
  const record = raw as Record<string, unknown>; // narrowed to a non-array object above
  const { type, v } = record;
  if (typeof type !== 'string') return fail('type', 'Must be a string');
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return fail('v', 'Must be a whole number >= 1');
  }

  if (type === 'batch') return upcastBatch(handlers, record.ops, v);

  const handler = handlers.find(type);
  if (handler === undefined) return fail('type', `Unknown operation type '${type}'`);
  if (v > handler.version) {
    return fail(
      'v',
      `Operation '${type}' has version ${String(v)}, newer than supported ${String(handler.version)}`,
    );
  }
  if (v === handler.version) return validated(handler, record);
  if (handler.upcast === undefined) {
    return fail('v', `Operation '${type}' version ${String(v)} cannot be migrated`);
  }
  const upcasted = handler.upcast(v, raw);
  if (upcasted.v !== handler.version) {
    throw new Error(
      `Upcast of '${type}' returned version ${String(upcasted.v)}, expected ${String(handler.version)}`,
    );
  }
  return validated(handler, upcasted);
}

function validated(
  handler: OpHandler,
  op: Readonly<Record<string, unknown>> | Operation,
): Result<Operation, OperationLoadError> {
  // Operation is a plain JSON object, so viewing it as a record for validate is safe.
  const record = op as Readonly<Record<string, unknown>>;
  const [first] = handler.validate?.(record) ?? [];
  if (first !== undefined) return err(first);
  return ok(record as unknown as Operation); // envelope checked by upcastOperation, payload above
}

function upcastBatch(
  handlers: OpHandlerRegistry,
  rawOps: unknown,
  v: number,
): Result<Operation, OperationLoadError> {
  if (v !== OP_VERSION.batch) {
    return fail(
      'v',
      `Batch has version ${String(v)}, newer than supported ${String(OP_VERSION.batch)}`,
    );
  }
  if (!Array.isArray(rawOps)) return fail('ops', 'Must be an array');
  const ops: Operation[] = [];
  for (const [i, rawOp] of (rawOps as readonly unknown[]).entries()) {
    const result = upcastOperation(handlers, rawOp);
    if (!result.ok) {
      const prefix = `ops[${String(i)}]`;
      const { path, message } = result.error;
      return fail(path === '' ? prefix : `${prefix}.${path}`, message);
    }
    ops.push(result.value);
  }
  return ok({ type: 'batch', v: OP_VERSION.batch, ops } as Operation); // BatchOp is structurally an Operation + ops
}
