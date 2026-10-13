import { describe, expect, it } from 'vitest';
import { bodyId } from '@/document';
import type { FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { bodyOfRef, bodyRefLabel } from './ref-values';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const B1 = bodyId(fid('f1'));
const B2 = bodyId(fid('f2'));
const B3 = bodyId(fid('f3'));

function aDoc() {
  return aDocument({
    features: [
      aFeature({ id: 'f1', name: 'Box 1' }),
      aFeature({ id: 'f2', name: 'Cylinder 1' }),
      aFeature({ id: 'f3', name: 'Box 2' }),
    ],
  });
}

describe('bodyOfRef', () => {
  it('is the body of a body reference', () => {
    expect(bodyOfRef({ kind: 'body', body: B1 })).toBe(B1);
    expect(bodyOfRef({ kind: 'body', body: bodyId(fid('f2'), 3) })).toBe(bodyId(fid('f2'), 3));
  });

  it('is null for anything else (params may hold anything)', () => {
    for (const junk of [
      null,
      undefined,
      1,
      'f1/body',
      { kind: 'body' },
      { kind: 'body', body: 3 },
      { kind: 'body', body: 'f1' },
      { kind: 'body', body: 'f1/body:0' },
      { kind: 'topo', body: B1, name: 'face:1' },
    ]) {
      expect(bodyOfRef(junk)).toBeNull();
    }
  });
});

describe('bodyRefLabel', () => {
  it('is the name from the metadata', () => {
    const doc = aDoc();
    doc.setBodyMeta(B1, { name: 'Base' });
    expect(bodyRefLabel(doc, B1)).toBe('Base');
  });

  it('is the name of the origin feature without a name in the metadata', () => {
    expect(bodyRefLabel(aDoc(), B2)).toBe('Cylinder 1');
  });

  it('adds the number of the body id as a suffix', () => {
    expect(bodyRefLabel(aDoc(), bodyId(fid('f2'), 2))).toBe('Cylinder 1 (2)');
  });

  it('is null when the origin feature is not in the document, even with a name', () => {
    const doc = aDoc();
    doc.setBodyMeta(B3, { name: 'Gone' });
    doc.removeFeature(fid('f3'));
    expect(bodyRefLabel(doc, B3)).toBeNull();
    expect(bodyRefLabel(doc, bodyId(fid('nope')))).toBeNull();
  });
});
