// One writer per document (spec 05, "Jeden zapisovatel na dokument"; Q038): a Web Lock named
// after the document, held for the whole session. The lock manager comes in as an interface,
// so the logic runs in Node with a fake; browser.ts passes navigator.locks.

import type { Disposable } from '@/core';
import type { DocumentId } from '@/document';

/** The part of the Web Locks LockManager this needs; navigator.locks is one. */
export interface DocumentLocks {
  /**
   * With `ifAvailable` the callback gets null at once when the name is held elsewhere. The
   * lock is held until the promise of the callback settles.
   */
  request(
    name: string,
    options: { readonly ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

export interface DocumentLock extends Disposable {
  /** false: another tab holds the document, open it read-only. */
  readonly held: boolean;
  /** Releases the lock; idempotent, nothing to do when not held. */
  dispose(): void;
}

export function documentLockName(docId: DocumentId): string {
  return `tinycad-doc-${docId}`;
}

/**
 * Asks for the lock of the document without waiting. Resolves with `held: true` while the lock
 * is ours, `held: false` when another tab has it. Rejects when the lock manager refuses.
 */
export function acquireDocumentLock(
  locks: DocumentLocks,
  docId: DocumentId,
): Promise<DocumentLock> {
  return new Promise<DocumentLock>((resolve, reject) => {
    let granted = false;
    locks
      .request(documentLockName(docId), { ifAvailable: true }, (lock) => {
        granted = true;
        if (lock === null) {
          resolve({ held: false, dispose: () => undefined });
          return Promise.resolve();
        }
        // The lock lives as long as this promise is pending; dispose resolves it.
        return new Promise<void>((release) => {
          resolve({ held: true, dispose: release });
        });
      })
      .catch((e: unknown) => {
        // Before the callback the request itself failed; after it, the lock is gone anyway.
        if (!granted) reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}
