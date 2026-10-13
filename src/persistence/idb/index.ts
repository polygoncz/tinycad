// Ring 3 – IndexedDB adapter of DocumentStore (worker). Imported only by app.
import { createRpcClient } from '@/core';
import type { Disposable } from '@/core';
import type { DocumentStore } from '@/persistence';
import { createDocumentStoreClient } from './client';
import type { DocumentStoreProtocol } from './protocol';

/**
 * DocumentStore backed by IndexedDB in a dedicated worker. A crashed worker or an
 * undecodable message fails all pending and later calls with 'disconnected' (Q037).
 * dispose() does the same and terminates the worker.
 */
export function createIdbDocumentStore(): DocumentStore & Disposable {
  const worker = new Worker(new URL('./persistence.worker.ts', import.meta.url), {
    type: 'module',
  });
  const rpc = createRpcClient<DocumentStoreProtocol>(worker);
  worker.onerror = (e) => {
    rpc.failAll(`Persistence worker failed: ${e.message}`);
  };
  worker.onmessageerror = () => {
    rpc.failAll('Persistence worker sent a message that could not be deserialized');
  };
  return {
    ...createDocumentStoreClient(rpc),
    dispose: () => {
      rpc.dispose();
      worker.terminate();
    },
  };
}
