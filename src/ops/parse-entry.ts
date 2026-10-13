import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { OperationLoadError } from './load-error';
import type { LogEntry } from './log';
import type { OpHandlerRegistry } from './op-handler';
import type { Operation } from './operation';
import { upcastOperation } from './upcast';

const KINDS: readonly string[] = ['do', 'undo', 'redo'] satisfies readonly LogEntry['kind'][];

const fail = (path: string, message: string): Result<LogEntry, OperationLoadError> =>
  err({ path, message });

const isWhole = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

/**
 * Data from outside (persistence, spec 05) -> LogEntry. op and inverse go through
 * upcastOperation. Whether target points at a 'do' entry is left to rebuildUndoStacks.
 */
export function parseLogEntry(
  handlers: OpHandlerRegistry,
  raw: unknown,
): Result<LogEntry, OperationLoadError> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('', 'Must be an object');
  }
  const record = raw as Readonly<Record<string, unknown>>; // narrowed to a non-array object above
  const { seq, kind, target, label, time } = record;
  if (!isWhole(seq, 1)) return fail('seq', 'Must be a whole number >= 1');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    return fail('kind', "Must be 'do', 'undo' or 'redo'");
  }
  if (kind === 'do') {
    if (target !== undefined) return fail('target', "Must be absent for kind 'do'");
  } else if (!isWhole(target, 1) || target >= seq) {
    return fail('target', `Must be a whole number >= 1 and < seq for kind '${kind}'`);
  }
  if (typeof label !== 'string') return fail('label', 'Must be a string');
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    return fail('time', 'Must be a finite number');
  }

  const op = operation(handlers, record.op, 'op');
  if (!op.ok) return op;
  const inverse = operation(handlers, record.inverse, 'inverse');
  if (!inverse.ok) return inverse;

  return ok({
    seq,
    kind: kind as LogEntry['kind'], // checked against KINDS above
    ...(typeof target === 'number' ? { target } : {}),
    op: op.value,
    inverse: inverse.value,
    label,
    time,
  });
}

function operation(
  handlers: OpHandlerRegistry,
  raw: unknown,
  prefix: string,
): Result<Operation, OperationLoadError> {
  const result = upcastOperation(handlers, raw);
  if (result.ok) return result;
  const { path, message } = result.error;
  return err({ path: path === '' ? prefix : `${prefix}.${path}`, message });
}
