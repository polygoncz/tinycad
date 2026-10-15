import { describe, expect, it } from 'vitest';
import * as persistence from '@/persistence';

// Guards the public API: a value export removed or added by accident shows up here.
describe('persistence public API', () => {
  it('exports exactly the runtime values of spec 05', () => {
    expect(Object.keys(persistence).sort()).toEqual([
      'createMemoryDocumentStore',
      'createPersistenceService',
      'createSnapshot',
      'createStoreError',
      'exportDocument',
      'exportStoredDocument',
      'importDocument',
      'loadDocument',
      'renamedTo',
      'snapshotSeqsToKeep',
      'storeErrorCode',
    ]);
  });
});
