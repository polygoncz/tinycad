// Ring 3 – IndexedDB adapter of DocumentStore (worker). Imported only by app.
import type { Disposable } from '@/core';
import type { DocumentStore } from '@/persistence';
import { createDocumentStoreClient } from './client';

/** DocumentStore backed by IndexedDB in a dedicated worker. dispose() terminates the worker. */
export function createIdbDocumentStore(): DocumentStore & Disposable {
  const worker = new Worker(new URL('./persistence.worker.ts', import.meta.url), {
    type: 'module',
  });
  return {
    ...createDocumentStoreClient(worker),
    dispose: () => {
      worker.terminate();
    },
  };
}
