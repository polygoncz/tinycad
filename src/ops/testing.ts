// Test-only entry point of ops: the in-memory double of the ports (dispatcher, log, transaction,
// undo; N121) and a ready-made session over it, for tests of interaction and the sketcher.
// dependency-cruiser allows importing it only from tests, so it never reaches the bundle. In
// production the server keeps the log and undo (server/src/ops) and app implements the ports over
// it (app/remote-dispatcher.ts).

import type { RegistryReader } from '@/core';
import { createFeatureSchemaRegistry } from '@/document';
import type { DocumentWriter, FeatureSchema } from '@/document';
import { aDocument } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import { createOperationDispatcher } from './dispatcher';
import { createOpHandlerRegistry } from './handler';
import type { OpHandlerRegistry } from './handler';
import { createOperationLog } from './log';
import type { OperationLog } from './log';
import type { OperationDispatcher, UndoManager } from './ports';
import { createUndoManager } from './undo';

export { createOperationDispatcher } from './dispatcher';
export { createOperationLog } from './log';
export type { OperationLog, OperationLogReader } from './log';
export { createUndoManager } from './undo';

export interface OpsSession {
  readonly doc: DocumentWriter;
  readonly handlers: OpHandlerRegistry;
  readonly log: OperationLog;
  readonly dispatcher: OperationDispatcher;
  readonly undo: UndoManager;
}

export interface OpsSessionOptions extends DocumentOptions {
  /** Feature schemas the handlers migrate feature data with (Q035). Defaults to none. */
  readonly schemas?: RegistryReader<FeatureSchema>;
}

/** A session over aDocument(init); LogEntry.time is deterministic (1, 2, 3, …). */
export function anOpsSession(init: OpsSessionOptions = {}): OpsSession {
  const { schemas = createFeatureSchemaRegistry(), ...documentOptions } = init;
  const doc = aDocument(documentOptions);
  const handlers = createOpHandlerRegistry({ schemas });
  const log = createOperationLog();
  let clock = 0;
  const dispatcher = createOperationDispatcher({ doc, handlers, log, now: () => ++clock });
  const undo = createUndoManager({ dispatcher, log });
  return { doc, handlers, log, dispatcher, undo };
}
