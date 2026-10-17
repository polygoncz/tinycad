// Waiting for the queue of changes of the session to drain: before a flush and before an export,
// so the server has everything the user did.

import type { Observable } from '@/core';

/** Resolves once `pending` (RemoteSession.pending, changes queued and in flight) is 0. */
export function queueEmpty(pending: Observable<number>): Promise<void> {
  if (pending.get() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = pending.subscribe(() => {
      if (pending.get() !== 0) return;
      unsubscribe();
      resolve();
    });
  });
}
