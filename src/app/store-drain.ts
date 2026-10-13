// AppSession.dispose saves what is pending with a flush it does not wait for (spec 11, "Kdo co
// uvolní"). openAppSession may release the store and the document lock only after that write,
// otherwise the IndexedDB worker dies under it and another tab could write meanwhile. This
// wrapper counts the store calls in flight, so openAppSession can wait until they are done.

import type { DocumentStore } from '@/persistence';

export interface DrainableStore {
  /** Delegates every call to the wrapped store and counts it while it runs. */
  readonly store: DocumentStore;
  /**
   * Resolves once no call is in flight and none started in the meantime. Call it after the
   * session is disposed, when no new writes come except those already chained.
   */
  drained(): Promise<void>;
}

export function createDrainableStore(inner: DocumentStore): DrainableStore {
  const inFlight = new Set<Promise<unknown>>();

  function track<T>(call: Promise<T>): Promise<T> {
    inFlight.add(call);
    const forget = (): void => {
      inFlight.delete(call);
    };
    call.then(forget, forget);
    return call;
  }

  return {
    store: {
      listDocuments: () => track(inner.listDocuments()),
      createDocument: (meta, initial) => track(inner.createDocument(meta, initial)),
      deleteDocument: (id) => track(inner.deleteDocument(id)),
      appendEntries: (id, entries) => track(inner.appendEntries(id, entries)),
      saveSnapshot: (id, snapshot) => track(inner.saveSnapshot(id, snapshot)),
      load: (id) => track(inner.load(id)),
    },
    async drained() {
      // A write chained onto a settled one starts in a microtask: let those run first, and
      // repeat until a whole round passes with nothing in flight.
      for (;;) {
        await nextTask();
        if (inFlight.size === 0) return;
        await Promise.allSettled(inFlight);
      }
    },
  };
}

/** One macrotask: every pending microtask chain runs before it. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
