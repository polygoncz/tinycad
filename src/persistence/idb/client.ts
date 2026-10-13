import type { RpcClient } from '@/core';
import type { DocumentStore } from '@/persistence';
import type { DocumentStoreProtocol } from './protocol';

/**
 * DocumentStore on the main thread that forwards every call to the worker. Store errors
 * arrive as RpcError with the same code, so callers read them with storeErrorCode.
 * Takes only `call` of the RPC client (ADR 0011, narrow interfaces): failAll and
 * dispose belong to the owner of the worker (Q037).
 */
export function createDocumentStoreClient(
  rpc: Pick<RpcClient<DocumentStoreProtocol>, 'call'>,
): DocumentStore {
  return {
    listDocuments: () => rpc.call('listDocuments'),
    createDocument: (meta, initial) => rpc.call('createDocument', meta, initial),
    deleteDocument: (id) => rpc.call('deleteDocument', id),
    appendEntries: (id, entries) => rpc.call('appendEntries', id, entries),
    saveSnapshot: (id, snapshot) => rpc.call('saveSnapshot', id, snapshot),
    load: (id) => rpc.call('load', id),
  };
}
