// Ring 3 – the persistence worker: serves the IndexedDB DocumentStore over core/rpc.
import { serveRpc } from '@/core';
import type { MessageEndpoint } from '@/core';
import { createIdbStoreImpl } from './idb-store';
import type { DocumentStoreProtocol } from './protocol';

// tsconfig.app.json types `self` as Window (lib DOM, not WebWorker), whose postMessage wants a
// targetOrigin. The options form exists on both Window and DedicatedWorkerGlobalScope, so this
// small adapter fits MessageEndpoint without a cast or another lib.
const endpoint: MessageEndpoint = {
  postMessage: (msg, transfer) => {
    self.postMessage(msg, { transfer });
  },
  addEventListener: (type, fn) => {
    self.addEventListener(type, fn);
  },
};

serveRpc<DocumentStoreProtocol>(endpoint, createIdbStoreImpl({ indexedDB, now: Date.now }));
