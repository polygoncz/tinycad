// Test-only entry point of ops: a ready-made session (document + handlers + log +
// dispatcher + undo). dependency-cruiser allows importing it only from *.test.ts.

import type { DocumentWriter } from '@/document';
import { aDocument } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import { createOperationDispatcher } from './dispatcher';
import type { OperationDispatcher } from './dispatcher';
import { createOpHandlerRegistry } from './handler';
import type { OpHandlerRegistry } from './handler';
import { createOperationLog } from './log';
import type { OperationLog } from './log';
import { createUndoManager } from './undo';
import type { UndoManager } from './undo';

export interface OpsSession {
  readonly doc: DocumentWriter;
  readonly handlers: OpHandlerRegistry;
  readonly log: OperationLog;
  readonly dispatcher: OperationDispatcher;
  readonly undo: UndoManager;
}

/** A session over aDocument(init); LogEntry.time is deterministic (1, 2, 3, …). */
export function anOpsSession(init: DocumentOptions = {}): OpsSession {
  const doc = aDocument(init);
  const handlers = createOpHandlerRegistry();
  const log = createOperationLog();
  let clock = 0;
  const dispatcher = createOperationDispatcher({ doc, handlers, log, now: () => ++clock });
  const undo = createUndoManager({ dispatcher, log });
  return { doc, handlers, log, dispatcher, undo };
}
