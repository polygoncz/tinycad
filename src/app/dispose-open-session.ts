// The order of release in openAppSession.dispose (spec 11, "Kompoziční kořen (app)", Zavření):
// dispose stays synchronous, but the store and the document lock must outlive the safety flush
// that session.dispose starts – a lock released earlier lets another tab write before the last
// entries are in, a store released earlier loses them. The viewport goes at once. Kept out of
// browser.ts, so it runs in Node with fakes.

import type { Disposable } from '@/core';
import type { AppSession } from './app-session';

export interface DisposeOpenSessionParts {
  readonly session: Pick<AppSession, 'dispose' | 'flush'>;
  /** Released at once, right after the session. */
  readonly viewport: Disposable;
  /** The store and the lock: released once the safety flush has settled. */
  readonly afterFlush: Disposable;
  /** Nobody awaits dispose, so a failed flush or release goes here. */
  readonly onError: (error: unknown) => void;
}

export function disposeOpenSession(parts: DisposeOpenSessionParts): void {
  const { session, onError } = parts;
  try {
    session.dispose();
  } finally {
    parts.viewport.dispose();
    // A flush after dispose chains onto the safety flush of dispose (the persistence service
    // runs one write at a time), so it settles only after that one has written the queue.
    void session
      .flush()
      .catch(onError)
      .then(() => {
        parts.afterFlush.dispose();
      })
      .catch(onError);
  }
}
