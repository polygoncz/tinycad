import { describe, expect, it } from 'vitest';
import type { DocumentId, DocumentMeta, FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type { FeatureSetParamsOp, LogEntry } from '@/ops';
import { createMemoryDocumentStore } from './memory-store';
import { createSnapshot } from './snapshot';
import { describeDocumentStoreContract } from './testing';

describeDocumentStoreContract('MemoryDocumentStore', ({ now }) =>
  Promise.resolve(createMemoryDocumentStore({ now })),
);

// The JSON copy would turn NaN into null and drop undefined: a test would pass on data that
// the real document could not load (revision C5). The store refuses it instead.
describe('MemoryDocumentStore – plain JSON only', () => {
  const meta: DocumentMeta = { id: 'd1' as DocumentId, name: 'Doc', createdAt: 0 };
  const featureId = 'a' as FeatureId;

  const op = (params: unknown): FeatureSetParamsOp => ({
    type: 'feature.setParams',
    v: OP_VERSION['feature.setParams'],
    featureId,
    typeVersion: 1,
    params,
  });
  const setParams = (seq: number, params: unknown): LogEntry => ({
    seq,
    kind: 'do',
    op: op(params),
    inverse: op({ size: 1 }),
    label: 'feature.setParams',
    time: 0,
  });

  async function aStore() {
    const store = createMemoryDocumentStore({ now: () => 0 });
    await store.createDocument(
      meta,
      createSnapshot(aDocument({ meta, features: [aFeature({ id: 'a' })] }), 0),
    );
    return store;
  }

  it.each([
    ['NaN', { size: Number.NaN }],
    ['Infinity', { size: Number.POSITIVE_INFINITY }],
    ['undefined', { size: 1, extra: undefined }],
    ['a Date', { at: new Date(0) }],
  ])('rejects an entry with %s and writes nothing of the batch', async (_, params) => {
    const store = await aStore();
    await expect(
      store.appendEntries(meta.id, [setParams(1, { size: 2 }), setParams(2, params)]),
    ).rejects.toThrow(/JSON/);
    expect((await store.load(meta.id))?.entries).toEqual([]);
  });

  it('rejects a snapshot with NaN', async () => {
    const store = await aStore();
    await store.appendEntries(meta.id, [setParams(1, { size: 2 })]);
    const doc = aDocument({
      meta,
      features: [aFeature({ id: 'a', params: { size: Number.NaN } })],
    });
    await expect(store.saveSnapshot(meta.id, createSnapshot(doc, 1))).rejects.toThrow(/JSON/);
    expect((await store.load(meta.id))?.snapshot).toMatchObject({ atSeq: 0 });
  });

  it('rejects a new document whose initial snapshot has NaN', async () => {
    const store = createMemoryDocumentStore();
    const doc = aDocument({
      meta,
      features: [aFeature({ id: 'a', params: { size: Number.NaN } })],
    });
    await expect(store.createDocument(meta, createSnapshot(doc, 0))).rejects.toThrow(/JSON/);
    expect(await store.listDocuments()).toEqual([]);
  });

  it('accepts plain JSON with minus zero', async () => {
    const store = await aStore();
    await store.appendEntries(meta.id, [setParams(1, { size: -0, list: [null, 'x', true] })]);
    expect((await store.load(meta.id))?.entries).toHaveLength(1);
  });
});
