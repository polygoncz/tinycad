import { createMemoryDocumentStore } from './memory-store';
import { describeDocumentStoreContract } from './testing';

describeDocumentStoreContract('MemoryDocumentStore', ({ now }) =>
  Promise.resolve(createMemoryDocumentStore({ now })),
);
