import { describe, expectTypeOf, it } from 'vitest';
import type { DocumentReader } from '@/document/document';

describe('document reader', () => {
  it('gives a reader no way to mutate or emit', () => {
    expectTypeOf<DocumentReader>().not.toHaveProperty('insertFeature');
    expectTypeOf<DocumentReader>().not.toHaveProperty('rename');
    expectTypeOf<DocumentReader>().not.toHaveProperty('replace');
    expectTypeOf<DocumentReader['events']>().not.toHaveProperty('emit');
  });
});
