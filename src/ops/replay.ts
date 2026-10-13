import type { DocumentWriter } from '@/document';
import { applyOperation } from './apply';
import { throwCollected } from './errors';
import type { LogEntry } from './log';
import type { OpHandlerRegistry } from './op-handler';

/**
 * Applies entry.op of every entry in order (for undo/redo entries op is exactly what was applied).
 * A failing handler throws at once; exceptions of document subscribers are deferred
 * so the replay runs to the end, then thrown (one as is, more as AggregateError).
 */
export function replayLog(
  doc: DocumentWriter,
  handlers: OpHandlerRegistry,
  entries: readonly LogEntry[],
): void {
  const deferred: unknown[] = [];
  for (const entry of entries) {
    deferred.push(...applyOperation(doc, handlers, entry.op).deferred);
  }
  throwCollected(deferred, 'Subscribers failed during replay');
}
