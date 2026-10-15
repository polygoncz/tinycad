// Read-only (Q038, spec 05 "Jeden zapisovatel na dokument"): a tab without the document lock
// reads the document but neither changes nor writes it. Everything that changes the document
// goes through one dispatcher, so refusing there covers the feature dialog, the tree, the tools
// and the actions; persistence without the lock is a stand-in that is always 'saved'.

import { ObservableValue } from '@/core';
import type { Observable } from '@/core';
import type { DocumentReader } from '@/document';
import type { OperationDispatcher, OperationLogReader } from '@/ops';
import { createPersistenceService } from '@/persistence';
import type { DocumentStore, PersistenceStatus, Scheduler } from '@/persistence';

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

/** Saving of the session's document: the PersistenceService with the lock, nothing without. */
export interface SessionPersistence {
  /** Always 'saved' when read-only. */
  readonly status: Observable<PersistenceStatus>;
  /** The text of the last failed write while 'error' or 'failed'; always null when read-only. */
  readonly error: Observable<string | null>;
  /** Writes the queue now; read-only: nothing. Works after release too (spec 05). */
  flush(): Promise<void>;
  /**
   * Stops saving on changes and writes the queue with one last flush, whose error goes to
   * `onError` (dispose does not save, spec 05). Read-only: nothing.
   */
  release(onError: (error: unknown) => void): void;
}

export function createSessionPersistence(deps: {
  readonly readOnly: boolean;
  readonly store: DocumentStore;
  readonly log: OperationLogReader;
  readonly doc: DocumentReader;
  readonly scheduler: Scheduler;
}): SessionPersistence {
  const status = new ObservableValue<PersistenceStatus>('saved');
  if (deps.readOnly) {
    return {
      status: status.asObservable(),
      error: new ObservableValue<string | null>(null).asObservable(),
      flush: () => Promise.resolve(),
      release: () => undefined,
    };
  }
  const { store, log, doc, scheduler } = deps;
  const service = createPersistenceService({ store, log, doc, scheduler });
  const offStatus = service.events.on('status', (e) => {
    status.set(e.status);
  });
  return {
    status: status.asObservable(),
    error: service.lastError,
    flush: () => service.flush(),
    release(onError) {
      offStatus();
      service.dispose();
      service.flush().catch(onError);
    },
  };
}
