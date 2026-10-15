import { describe, expectTypeOf, it } from 'vitest';
import type { DocumentReader, DocumentWriter } from '@/document/document';

describe('document role interfaces', () => {
  it('lets a writer be passed where a reader is expected', () => {
    expectTypeOf<DocumentWriter>().toExtend<DocumentReader>();
  });

  it('gives a reader no way to mutate or emit', () => {
    expectTypeOf<DocumentReader>().not.toHaveProperty('insertFeature');
    expectTypeOf<DocumentReader>().not.toHaveProperty('rename');
    expectTypeOf<DocumentReader['events']>().not.toHaveProperty('emit');
  });
});
