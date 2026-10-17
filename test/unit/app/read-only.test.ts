import { describe, expect, it } from 'vitest';
import { createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { createOpHandlerRegistry } from '@/ops';
import { anOpsSession, createOperationDispatcher, createOperationLog } from '@/ops/testing';
import type { DocumentRenameOp, OperationDispatcher } from '@/ops';
import { refuseChanges, refuseUndo } from '@/app/read-only';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;

describe('refuseChanges', () => {
  function inner(): OperationDispatcher {
    const schemas = createFeatureSchemaRegistry();
    return createOperationDispatcher({
      doc: createDocument({ meta: { id: DOC, name: 'Doc', createdAt: 0 } }),
      handlers: createOpHandlerRegistry({ schemas }),
      log: createOperationLog(),
      now: () => 0,
    });
  }

  it('dispatch and begin throw, the document is open read-only', () => {
    const guarded = refuseChanges(inner());
    const op: DocumentRenameOp = { type: 'document.rename', v: 1, name: 'x' };
    expect(() => guarded.dispatch(op)).toThrow(/read-only/);
    expect(() => guarded.begin('edit')).toThrow(/read-only/);
  });

  it('keeps the transaction state and the events of the inner dispatcher', () => {
    const wrapped = inner();
    const guarded = refuseChanges(wrapped);
    expect(guarded.inTransaction).toBe(false);
    expect(guarded.events).toBe(wrapped.events);
  });
});

describe('refuseUndo', () => {
  it('cannot undo or redo and both refuse; the stacks and events stay', () => {
    const { undo } = anOpsSession();
    const guarded = refuseUndo(undo);
    expect(guarded.canUndo()).toBe(false);
    expect(guarded.canRedo()).toBe(false);
    expect(() => {
      guarded.undo();
    }).toThrow(/read-only/);
    expect(() => {
      guarded.redo();
    }).toThrow(/read-only/);
    expect(guarded.stacks()).toEqual(undo.stacks());
    expect(guarded.events).toBe(undo.events);
  });
});
