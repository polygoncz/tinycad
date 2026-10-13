import { describe, expect, it } from 'vitest';
import * as persistence from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('persistence public API', () => {
  it('exports exactly the runtime values of spec 05', () => {
    expect(Object.keys(persistence).sort()).toEqual([
      'createMemoryDocumentStore',
      'createPersistenceService',
      'createSnapshot',
      'createStoreError',
      'exportDocument',
      'importDocument',
      'loadDocument',
      'snapshotSeqsToKeep',
      'storeErrorCode',
    ]);
  });
});
