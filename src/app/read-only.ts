// Read-only (Q038, Q102): a tab the core does not let write reads the document but does not
// change it. Everything that changes the document goes through one dispatcher, so refusing
// there covers the feature dialog, the tree, the tools and the actions.

import type { OperationDispatcher } from '@/ops';

/** A dispatcher that refuses every change; reading and its events stay. */
export function refuseChanges(inner: OperationDispatcher): OperationDispatcher {
  const refuse = (): never => {
    throw new Error('The document is open read-only (open in another tab)');
  };
  return {
    dispatch: refuse,
    begin: refuse,
    get inTransaction() {
      return inner.inTransaction;
    },
    events: inner.events,
  };
}
