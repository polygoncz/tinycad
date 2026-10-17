// The runner of the shared cases ops.script (spec 13, Druhy případů; spec 04): a session script of
// dispatch, transactions and undo/redo over the handlers the optimistic mirror of the client runs
// (N63). The C++ core is the reference (N124): ops.upcast and ops.replay run only there, because
// loading and replaying stored logs is the core's alone.

import { fromData, toData } from '@/document/testing';
import type { DocumentWriter } from '@/document';
import { createOpHandlerRegistry } from '@/ops';
import { createOperationDispatcher, createOperationLog, createUndoManager } from '@/ops/testing';
import type { LogEntry, Operation, Transaction } from '@/ops';
import type { CaseOutcome } from './support/case';
import { builtInSchemas } from './support/schemas';
import { describeSharedCases } from './support/runner';

// The handlers check the feature data of feature.add and feature.setParams with the schemas of the
// core (Q035, N67).
const schemas = builtInSchemas();
const handlers = createOpHandlerRegistry({ schemas });

describeSharedCases('ops', {
  'ops.script': {
    run(input) {
      return runScript(loadDocument(field(input, 'document')), arrayField(input, 'steps'));
    },
  },
});

/**
 * Runs the steps of ops.script over one session. The time of a log entry is the order of the
 * step that wrote it (1, 2, 3…), so the log is deterministic (spec 13, Soubory a běh).
 */
function runScript(doc: DocumentWriter, steps: readonly unknown[]): CaseOutcome {
  const log = createOperationLog();
  let step = 0;
  const dispatcher = createOperationDispatcher({ doc, handlers, log, now: () => step });
  const undo = createUndoManager({ dispatcher, log });
  let transaction: Transaction | undefined;
  const open = (): Transaction => {
    if (transaction === undefined) throw new Error(`step ${String(step)}: no transaction`);
    return transaction;
  };

  for (const raw of steps) {
    step++;
    const s = asRecord(raw, `steps[${String(step - 1)}]`);
    if ('dispatch' in s) {
      const label = s['label'];
      dispatcher.dispatch(asOperation(s['dispatch']), typeof label === 'string' ? { label } : {});
    } else if ('begin' in s) {
      const label = s['begin'];
      if (typeof label !== 'string') throw new Error(`step ${String(step)}: begin needs a label`);
      transaction = dispatcher.begin(label);
    } else if ('apply' in s) {
      open().apply(asOperation(s['apply']));
    } else if ('applyTransient' in s) {
      open().applyTransient(asOperation(s['applyTransient']));
    } else if (s['commit'] === true) {
      open().commit();
      transaction = undefined;
    } else if (s['abort'] === true) {
      open().abort();
      transaction = undefined;
    } else if (s['undo'] === true) {
      undo.undo();
    } else if (s['redo'] === true) {
      undo.redo();
    } else {
      throw new Error(`step ${String(step)}: unknown step ${JSON.stringify(raw)}`);
    }
  }

  const entries: readonly LogEntry[] = log.entries();
  return {
    ok: {
      document: toData(doc),
      log: entries,
      canUndo: undo.canUndo(),
      canRedo: undo.canRedo(),
    },
  };
}

/** The DocumentData of a case; a document fromData refuses is a broken case. */
function loadDocument(raw: unknown): DocumentWriter {
  const loaded = fromData(raw, schemas);
  if (!loaded.ok) throw new Error(`input.document: ${JSON.stringify(loaded.error.issues)}`);
  return loaded.value;
}

/** An operation of a script step; dispatch and the transaction validate it before applying. */
function asOperation(raw: unknown): Operation {
  const record = asRecord(raw, 'operation');
  if (typeof record['type'] !== 'string' || typeof record['v'] !== 'number') {
    throw new Error(`An operation needs type and v: ${JSON.stringify(raw)}`);
  }
  // type and v checked above; the handler validates the payload (spec 04, M19.1).
  return record as unknown as Operation;
}

function field(input: unknown, key: string): unknown {
  return asRecord(input, 'input')[key];
}

function arrayField(input: unknown, key: string): readonly unknown[] {
  const value = field(input, key);
  if (!Array.isArray(value)) throw new Error(`input.${key} must be an array`);
  // Array.isArray narrows to any[]; the elements are read as unknown.
  return value as readonly unknown[];
}

function asRecord(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`);
  }
  // A non-null, non-array object: its keys are read as unknown values.
  return value as Readonly<Record<string, unknown>>;
}
