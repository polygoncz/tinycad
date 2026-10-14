import { describe, expect, it, vi } from 'vitest';
import { ObservableValue } from '@/core';
import { bodyId, createDocument, createFeatureSchemaRegistry, toData } from '@/document';
import type { BodyId, DocumentId, FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import type { GeometryKernel, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createOpHandlerRegistry } from '@/ops';
import { createMemoryDocumentStore, createSnapshot, exportDocument } from '@/persistence';
import type { PersistenceStatus } from '@/persistence';
import { EMPTY_NAMES, EMPTY_STATE } from '@/regen';
import type { RegenState } from '@/regen';
import { createFileExporter } from './file-exporter';
import type { DownloadFile } from './file-exporter';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;
const F1 = 'f1' as FeatureId;
const F2 = 'f2' as FeatureId;
const A = bodyId(F1);
const B = bodyId(F2);

/** A state with the bodies in this order. */
function aState(
  bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[],
): RegenState {
  const artifacts = new Map(EMPTY_STATE.artifacts);
  for (const { id, shape } of bodies) {
    const origin = id === A ? F1 : F2;
    artifacts.set(id, {
      kind: 'body',
      id,
      origin,
      lastModifiedBy: origin,
      shape,
      names: EMPTY_NAMES,
    });
  }
  return { artifacts };
}

function text(data: DownloadFile['data']): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data);
}

async function setup(
  opts: {
    readonly name?: string;
    readonly stored?: boolean;
    readonly persistence?: PersistenceStatus;
    readonly flushError?: Error;
  } = {},
) {
  const kernel = createFakeKernel();
  const small = (await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] })).shape;
  const large = (await kernel.makeBox({ origin: [0, 0, 0], size: [7, 7, 7] })).shape;
  const busy = new ObservableValue(false);
  let state = aState([
    { id: A, shape: small },
    { id: B, shape: large },
  ]);
  let liveKernel: GeometryKernel | null = kernel;
  const downloads: DownloadFile[] = [];
  const order: string[] = [];
  const meta = { id: DOC, name: opts.name ?? 'Držák', createdAt: 0 };
  let name = meta.name;
  const doc = createDocument({ meta });
  const store = createMemoryDocumentStore({ now: () => 0 });
  if (opts.stored ?? true) await store.createDocument(meta, createSnapshot(doc, 0));
  // The live document holds work the store does not: a feature that was never saved.
  const live = aDocument({ meta, features: [aFeature({ id: 'unsaved', name: 'Not saved' })] });
  const schemas = createFeatureSchemaRegistry();
  const exporter = createFileExporter({
    name: () => name,
    regenBusy: busy.asObservable(),
    lastState: () => state,
    kernel: () => liveKernel,
    flush: () => {
      order.push('flush');
      return opts.flushError === undefined ? Promise.resolve() : Promise.reject(opts.flushError);
    },
    liveFile: () => {
      order.push('liveFile');
      return exportDocument(live);
    },
    persistenceStatus: () => opts.persistence ?? 'saved',
    store,
    docId: DOC,
    schemas,
    handlers: createOpHandlerRegistry({ schemas }),
    download: (file) => {
      order.push('download');
      downloads.push(file);
    },
  });
  return {
    kernel,
    small,
    large,
    busy,
    exporter,
    downloads,
    order,
    live,
    setState: (next: RegenState) => {
      state = next;
    },
    setKernel: (next: GeometryKernel | null) => {
      liveKernel = next;
    },
    rename: (next: string) => {
      name = next;
    },
  };
}

describe('FileExporter – STEP', () => {
  it('downloads <name>.step with the bodies in the given order', async () => {
    const { exporter, downloads } = await setup();
    await exporter.exportStep([B, A]);
    expect(downloads).toHaveLength(1);
    const [file] = downloads;
    expect(file?.name).toBe('Držák.step');
    expect(file?.mime).toBe('model/step');
    const step = text(file?.data ?? '');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    // FakeKernel writes one line per shape with its bounding box, in the order of the call.
    const solids = step.split('\n').filter((line) => line.includes('FAKE_SOLID'));
    expect(solids).toHaveLength(2);
    expect(solids[0]).toContain('7');
    expect(solids[1]).not.toContain('7');
  });

  it('reads the document name at the time of the export', async () => {
    const { exporter, downloads, rename } = await setup();
    rename('Nový');
    await exporter.exportStep([A]);
    expect(downloads[0]?.name).toBe('Nový.step');
  });

  it('makes the document name safe for a file name', async () => {
    const { exporter, downloads } = await setup({ name: 'a/b: c.' });
    await exporter.exportStep([A]);
    expect(downloads[0]?.name).toBe('a_b_ c.step');
  });

  it('skips a body that is not in the last state; none left → rejects without a download', async () => {
    const { exporter, downloads, kernel, setState, small } = await setup();
    setState(aState([{ id: A, shape: small }]));
    const exportStep = vi.spyOn(kernel, 'exportStep');
    await exporter.exportStep([B, A]);
    expect(exportStep).toHaveBeenCalledWith([small]);
    await expect(exporter.exportStep([B])).rejects.toThrow();
    expect(downloads).toHaveLength(1);
  });

  it('rejects without a live kernel', async () => {
    const { exporter, downloads, setKernel } = await setup();
    setKernel(null);
    await expect(exporter.exportStep([A])).rejects.toThrow(/kernel/i);
    expect(downloads).toEqual([]);
  });

  it('a failed kernel export rejects without a download', async () => {
    const { exporter, downloads, kernel } = await setup();
    kernel.failNext('exportStep', 'operation-failed', 'STEP writer failed');
    await expect(exporter.exportStep([A])).rejects.toThrow('STEP writer failed');
    expect(downloads).toEqual([]);
  });

  it('waits until the regeneration is idle, then exports the new state', async () => {
    const { exporter, downloads, kernel, busy, setState, small } = await setup();
    busy.set(true);
    const exportStep = vi.spyOn(kernel, 'exportStep');
    const done = exporter.exportStep([A]);
    await Promise.resolve();
    expect(exportStep).not.toHaveBeenCalled();

    const fresh = (await kernel.makeBox({ origin: [0, 0, 0], size: [2, 2, 2] })).shape;
    setState(aState([{ id: A, shape: fresh }]));
    busy.set(false);
    await done;
    expect(exportStep).toHaveBeenCalledWith([fresh]);
    expect(exportStep).not.toHaveBeenCalledWith([small]);
    expect(downloads).toHaveLength(1);
  });
});

describe('FileExporter – document', () => {
  it('flushes, then downloads <name>.tinycad.json as indented JSON of the stored document', async () => {
    const { exporter, downloads, order } = await setup();
    expect(await exporter.exportDocument()).toEqual({ withHistory: true });
    // The live file is not made when the store has the document.
    expect(order).toEqual(['flush', 'download']);
    const [file] = downloads;
    expect(file?.name).toBe('Držák.tinycad.json');
    expect(file?.mime).toBe('application/json');
    const data = text(file?.data ?? '');
    expect(data.endsWith('}\n')).toBe(true);
    const parsed: unknown = JSON.parse(data);
    expect(data).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(parsed).toMatchObject({ format: 'tinycad.file', formatVersion: 2 });
    expect(parsed).toHaveProperty('history');
  });

  it('the store failed for good (D4) → downloads the live file without history, no flush', async () => {
    const { exporter, downloads, order, live } = await setup({ persistence: 'failed' });
    expect(await exporter.exportDocument()).toEqual({ withHistory: false });
    expect(order).toEqual(['liveFile', 'download']);
    const [file] = downloads;
    expect(file?.name).toBe('Držák.tinycad.json');
    const parsed: unknown = JSON.parse(text(file?.data ?? ''));
    const document: unknown = JSON.parse(JSON.stringify(toData(live)));
    expect(parsed).not.toHaveProperty('history');
    expect(parsed).toEqual({
      format: 'tinycad.file',
      formatVersion: 2,
      snapshot: { format: 'tinycad.snapshot', formatVersion: 1, atSeq: 0, document },
    });
  });

  it('a failed flush → downloads the live file without history', async () => {
    const { exporter, downloads, order, live } = await setup({
      persistence: 'error',
      flushError: new Error('quota exceeded'),
    });
    expect(await exporter.exportDocument()).toEqual({ withHistory: false });
    expect(order).toEqual(['flush', 'liveFile', 'download']);
    const parsed: unknown = JSON.parse(text(downloads[0]?.data ?? ''));
    expect(parsed).not.toHaveProperty('history');
    expect(parsed).toMatchObject({ snapshot: { atSeq: 0, document: { studio: live.studio } } });
  });

  it('rejects when the stored document cannot be read, without a download', async () => {
    const { exporter, downloads } = await setup({ stored: false });
    await expect(exporter.exportDocument()).rejects.toThrow(/not found/);
    expect(downloads).toEqual([]);
  });
});
