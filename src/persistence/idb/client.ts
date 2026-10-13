import { createRpcClient } from '@/core';
import type { MessageEndpoint } from '@/core';
import type { DocumentStore } from '@/persistence';
import type { DocumentStoreProtocol } from './protocol';

/**
 * DocumentStore on the main thread that forwards every call to the worker. Store errors
 * arrive as RpcError with the same code, so callers read them with storeErrorCode.
 */
export function createDocumentStoreClient(ep: MessageEndpoint): DocumentStore {
  const rpc = createRpcClient<DocumentStoreProtocol>(ep);
  return {
    listDocuments: () => rpc.call('listDocuments'),
    createDocument: (meta, initial) => rpc.call('createDocument', meta, initial),
    deleteDocument: (id) => rpc.call('deleteDocument', id),
    appendEntries: (id, entries) => rpc.call('appendEntries', id, entries),
    saveSnapshot: (id, snapshot) => rpc.call('saveSnapshot', id, snapshot),
    load: (id) => rpc.call('load', id),
  };
}
