import type { DocumentStore } from '@/persistence';

/**
 * RPC protocol of the persistence worker: one protocol method per DocumentStore method, with
 * the same arguments and result. Derived from the port, so the two cannot drift apart.
 */
export type DocumentStoreProtocol = {
  readonly [K in keyof DocumentStore]: {
    readonly args: Parameters<DocumentStore[K]>;
    readonly result: Awaited<ReturnType<DocumentStore[K]>>;
  };
};
