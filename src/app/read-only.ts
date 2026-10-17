// Read-only (Q038, Q102): a tab the core does not let write reads the document but does not
// change it. Everything that changes the document goes through one dispatcher, so refusing
// there covers the feature dialog, the tree, the tools and the actions.

import type { OperationDispatcher, UndoManager } from '@/ops';

const refuse = (): never => {
  throw new Error('The document is open read-only (open in another tab)');
};

/** A dispatcher that refuses every change; reading and its events stay. */
export function refuseChanges(inner: OperationDispatcher): OperationDispatcher {
  return {
    dispatch: refuse,
    begin: refuse,
    get inTransaction() {
      return inner.inTransaction;
    },
    events: inner.events,
  };
}

/** Undo of a read-only tab: nothing to undo or redo, both refuse; the stacks stay readable. */
export function refuseUndo(inner: UndoManager): UndoManager {
  return {
    canUndo: () => false,
    canRedo: () => false,
    stacks: () => inner.stacks(),
    undo: refuse,
    redo: refuse,
    events: inner.events,
    dispose: () => undefined,
  };
}
