import { describe, expect, it } from 'vitest';
import type { BodyId, DocumentId, FeatureId, PartStudioData } from '@/document';
import { aFeature } from '@/document/testing';
import type { ReadModelData } from '@/remote';
import { MirrorDocument } from '@/app/mirror-document';

type DocumentData = ReadModelData['document'];

function aDocumentData(studio: Partial<PartStudioData> = {}, name = 'Part'): DocumentData {
  const features = studio.features ?? [];
  return {
    id: 'doc-1' as DocumentId, // test ids are trusted
    name,
    createdAt: 0,
    lastSeq: 0,
    studio: { features, rollbackIndex: features.length, ...studio },
  };
}

function setup(data: DocumentData = aDocumentData()) {
  const control = new MirrorDocument(data);
  const mirror = control.reader;
  let changes = 0;
  mirror.events.on('changed', () => changes++);
  return { control, mirror, changes: () => changes };
}

describe('MirrorDocument', () => {
  it('the reader has no way to write or reset (ADR 0011: only the handlers write)', () => {
    const { mirror } = setup();
    expect('writer' in mirror).toBe(false);
    expect('reset' in mirror).toBe(false);
    expect('insertFeature' in mirror).toBe(false);
  });

  it('takes createdAt of the read model into its meta (N89)', () => {
    const { mirror } = setup({ ...aDocumentData(), createdAt: 1_700_000_000_000 });
    expect(mirror.meta.createdAt).toBe(1_700_000_000_000);
  });

  it('reads the document of the read model', () => {
    const box = aFeature({ id: 'f1' });
    const { mirror } = setup(aDocumentData({ features: [box] }, 'Bracket'));
    expect(mirror.meta.id).toBe('doc-1');
    expect(mirror.meta.name).toBe('Bracket');
    expect(mirror.studio.features).toEqual([box]);
    expect(mirror.feature(box.id)).toEqual(box);
    expect(mirror.indexOf(box.id)).toBe(0);
    expect(mirror.bodyMeta('f1/body' as BodyId)).toEqual({});
  });

  it('writes through writer() and sends changed', () => {
    const { control, mirror, changes } = setup();
    const box = aFeature({ id: 'f1' });
    control.writer().insertFeature(0, box);
    expect(mirror.studio.features).toEqual([box]);
    expect(control.writer().studio).toBe(mirror.studio);
    expect(changes()).toBe(1);
  });

  it('reset replaces the content and sends changed once', () => {
    const { control, mirror, changes } = setup(
      aDocumentData({ features: [aFeature({ id: 'f1' })] }),
    );
    const other = aFeature({ id: 'f2' });
    control.reset(aDocumentData({ features: [other] }, 'Renamed'));
    expect(mirror.studio.features.map((f) => f.id)).toEqual(['f2']);
    expect(mirror.meta.name).toBe('Renamed');
    expect(changes()).toBe(1);
  });

  it('reset with equal data sends nothing and keeps the objects', () => {
    const box = aFeature({ id: 'f1', params: { size: 3 } });
    const { control, mirror, changes } = setup(aDocumentData({ features: [box] }));
    const before = mirror.studio;
    control.reset(
      aDocumentData({ features: [aFeature({ id: 'f1', name: box.name, params: { size: 3 } })] }),
    );
    expect(changes()).toBe(0);
    expect(mirror.studio).toBe(before);
  });

  it('reset keeps the objects of unchanged features', () => {
    const a = aFeature({ id: 'f1' });
    const b = aFeature({ id: 'f2', params: { size: 1 } });
    const { control, mirror, changes } = setup(aDocumentData({ features: [a, b] }));
    const keptA = mirror.feature(a.id);
    control.reset(aDocumentData({ features: [{ ...a }, { ...b, params: { size: 2 } }] }));
    expect(changes()).toBe(1);
    expect(mirror.feature(a.id)).toBe(keptA);
    expect(mirror.feature(b.id)?.params).toEqual({ size: 2 });
  });

  it('the writer keeps working after a reset and the events of the new content arrive', () => {
    const { control, mirror, changes } = setup();
    const writer = control.writer();
    control.reset(aDocumentData({ features: [aFeature({ id: 'f1' })] }));
    writer.removeFeature('f1' as FeatureId); // test ids are trusted
    expect(mirror.studio.features).toEqual([]);
    expect(changes()).toBe(2);
  });

  it('a change of the rollback index or the body metadata alone is a change', () => {
    const box = aFeature({ id: 'f1' });
    const { control, mirror, changes } = setup(aDocumentData({ features: [box] }));
    control.reset(aDocumentData({ features: [box], rollbackIndex: 0 }));
    expect(mirror.studio.rollbackIndex).toBe(0);
    control.reset(
      aDocumentData({
        features: [box],
        rollbackIndex: 0,
        bodies: { ['f1/body' as BodyId]: { name: 'Lid' } },
      }),
    );
    expect(mirror.bodyMeta('f1/body' as BodyId)).toEqual({ name: 'Lid' });
    expect(changes()).toBe(2);
  });
});
