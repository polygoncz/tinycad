import { describe, expect, it } from 'vitest';
import { toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createSnapshot } from './snapshot';

describe('createSnapshot', () => {
  it('wraps the document data in a versioned envelope at the given seq', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a' })] });
    const snapshot = createSnapshot(doc, 7);
    expect(snapshot).toEqual({
      format: 'tinycad.snapshot',
      formatVersion: 1,
      atSeq: 7,
      document: toData(doc),
    });
  });

  it('does not copy the immutable document data', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a' })] });
    expect(createSnapshot(doc, 0).document.studio).toBe(doc.studio);
  });

  it('survives a JSON round trip unchanged', () => {
    const snapshot = createSnapshot(aDocument({ features: [aFeature({ id: 'a' })] }), 3);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
