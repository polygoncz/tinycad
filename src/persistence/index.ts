// Ring 1 – DocumentStore port and persistence services.
// Public API of persistence (spec 05). Everything else in this folder is internal.

export { createSnapshot } from './snapshot';
export type { DocumentSnapshot } from './snapshot';
export { createStoreError, snapshotSeqsToKeep, storeErrorCode } from './store';
export type { DocumentInfo, DocumentStore, DocumentStoreErrorCode, StoredDocument } from './store';
export { createMemoryDocumentStore } from './memory-store';
export { createPersistenceService } from './service';
export type { PersistenceService, PersistenceStatus, Scheduler } from './service';
export { loadDocument } from './load';
export type { LoadDocumentError, LoadedDocument } from './load';
export { exportDocument, exportStoredDocument, importDocument } from './file';
export type { TinycadFile, TinycadHistory } from './file';
