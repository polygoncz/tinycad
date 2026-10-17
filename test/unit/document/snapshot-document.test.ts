import { describe, expect, it } from 'vitest';
import { createSnapshotDocument } from '@/document';
import type { BodyId, DocumentId, DocumentSnapshot, PartStudioData } from '@/document';
import { aFeature, aSnapshotDocument } from '@/document/testing';

function aSnapshot(studio: Partial<PartStudioData> = {}, name = 'Part'): DocumentSnapshot {
  const features = studio.features ?? [];
  return {
    meta: { id: 'doc-1' as DocumentId, name, createdAt: 0 }, // test ids are trusted
    studio: { features, rollbackIndex: features.length, ...studio },
  };
}

function setup(initial: DocumentSnapshot = aSnapshot()) {
  const document = createSnapshotDocument(initial);
  const { reader } = document;
  const studios: PartStudioData[] = [];
  reader.events.on('changed', (e) => studios.push(e.studio));
  return { document, reader, changes: () => studios.length, studios };
}

const LID = 'f1/body' as BodyId; // test ids are trusted

describe('createSnapshotDocument', () => {
  it('reads the snapshot: meta, studio, features, index and body metadata', () => {
    const box = aFeature({ id: 'f1' });
    const { reader } = setup({
      meta: { id: 'doc-1' as DocumentId, name: 'Bracket', createdAt: 1_700_000_000_000 },
      studio: { features: [box], rollbackIndex: 1, bodies: { [LID]: { name: 'Lid' } } },
    });
    expect(reader.meta).toEqual({ id: 'doc-1', name: 'Bracket', createdAt: 1_700_000_000_000 });
    expect(reader.studio.features).toEqual([box]);
    expect(reader.feature(box.id)).toEqual(box);
    expect(reader.indexOf(box.id)).toBe(0);
    expect(reader.indexOf(aFeature({ id: 'nope' }).id)).toBe(-1);
    expect(reader.bodyMeta(LID)).toEqual({ name: 'Lid' });
  });

  it('a body without metadata reads one shared frozen {}', () => {
    const { reader } = setup();
    const a = reader.bodyMeta('f9/body' as BodyId);
    expect(a).toEqual({});
    expect(Object.isFrozen(a)).toBe(true);
    expect(reader.bodyMeta('f8/body' as BodyId)).toBe(a);
  });

  it('the snapshot and its arrays are frozen', () => {
    const { reader } = setup(aSnapshot({ features: [aFeature({ id: 'f1' })] }));
    expect(Object.isFrozen(reader.meta)).toBe(true);
    expect(Object.isFrozen(reader.studio)).toBe(true);
    expect(Object.isFrozen(reader.studio.features)).toBe(true);
    expect(Object.isFrozen(reader.studio.features[0])).toBe(true);
  });

  it('the reader is no SnapshotDocument: it has no replace', () => {
    const { reader } = setup();
    expect('replace' in reader).toBe(false);
    expect('insertFeature' in reader).toBe(false);
  });

  it('replace swaps the content and sends changed once', () => {
    const { document, reader, changes } = setup(aSnapshot({ features: [aFeature({ id: 'f1' })] }));
    document.replace(aSnapshot({ features: [aFeature({ id: 'f2' })] }, 'Renamed'));
    expect(reader.studio.features.map((f) => f.id)).toEqual(['f2']);
    expect(reader.meta.name).toBe('Renamed');
    expect(changes()).toBe(1);
  });

  it('replace with equal data sends nothing and keeps the objects', () => {
    const box = aFeature({ id: 'f1', params: { size: 3 } });
    const { document, reader, changes } = setup(aSnapshot({ features: [box] }));
    const before = reader.studio;
    document.replace(
      aSnapshot({ features: [aFeature({ id: 'f1', name: box.name, params: { size: 3 } })] }),
    );
    expect(changes()).toBe(0);
    expect(reader.studio).toBe(before);
  });

  it('replace keeps the objects of unchanged features and of equal bodies', () => {
    const a = aFeature({ id: 'f1' });
    const b = aFeature({ id: 'f2', params: { size: 1 } });
    const bodies = { [LID]: { name: 'Lid' } };
    const { document, reader, changes } = setup(aSnapshot({ features: [a, b], bodies }));
    const keptA = reader.feature(a.id);
    const keptBodies = reader.studio.bodies;
    document.replace(
      aSnapshot({
        features: [{ ...a }, { ...b, params: { size: 2 } }],
        bodies: { [LID]: { name: 'Lid' } },
      }),
    );
    expect(changes()).toBe(1);
    expect(reader.feature(a.id)).toBe(keptA);
    expect(reader.studio.bodies).toBe(keptBodies);
    expect(reader.feature(b.id)?.params).toEqual({ size: 2 });
  });

  it('a change of the rollback index or the body metadata alone is a change', () => {
    const box = aFeature({ id: 'f1' });
    const { document, reader, changes } = setup(aSnapshot({ features: [box] }));
    document.replace(aSnapshot({ features: [box], rollbackIndex: 0 }));
    expect(reader.studio.rollbackIndex).toBe(0);
    document.replace(aSnapshot({ features: [box], rollbackIndex: 0, bodies: { [LID]: {} } }));
    expect(reader.bodyMeta(LID)).toEqual({});
    expect(changes()).toBe(2);
  });

  it('a rename alone sends changed with the unchanged studio', () => {
    const { document, reader, studios } = setup(aSnapshot({ features: [aFeature({ id: 'f1' })] }));
    const before = reader.studio;
    document.replace({ meta: { ...reader.meta, name: 'Bracket' }, studio: reader.studio });
    expect(reader.meta.name).toBe('Bracket');
    expect(studios).toEqual([before]);
    expect(studios[0]).toBe(before);
  });
});

describe('aSnapshotDocument', () => {
  it('replace takes only the given parts', () => {
    const box = aFeature({ id: 'f1' });
    const doc = aSnapshotDocument({ features: [box] });
    let changes = 0;
    doc.events.on('changed', () => changes++);
    doc.replace({ name: 'Bracket' });
    expect(doc.meta.name).toBe('Bracket');
    expect(doc.studio.features).toEqual([box]);
    doc.replace({ studio: { features: [], rollbackIndex: 0 } });
    expect(doc.meta.name).toBe('Bracket');
    expect(doc.feature(box.id)).toBeUndefined();
    expect(changes).toBe(2);
  });
});
