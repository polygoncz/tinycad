import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import {
  bodyId,
  createDocument,
  ORIGIN_AXES,
  ORIGIN_AXIS_IDS,
  ORIGIN_PLANE_IDS,
  ORIGIN_PLANES,
  sketchId,
} from '@/document';
import type { BodyId, DocumentId, FeatureId, TopoName } from '@/document';
import { boxPlugin } from '@/features/box';
import { extrudePlugin } from '@/features/extrude';
import { filletPlugin } from '@/features/fillet';
import { sketchPlugin } from '@/features/sketch';
import { transformPlugin } from '@/features/transform';
import { axisDrawing, EDIT_SKETCH_DRAWING_ID, planeDrawing } from '@/interaction';
import type { ConfirmRequest, ViewKeyEvent, ViewPointerEvent } from '@/interaction';
import { createMemoryDocumentStore, createSnapshot } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import type { ManualScheduler } from '@/persistence/testing';
import type { FeaturePlugin } from '@/plugin-api';
import { aSchema, aSketchArtifact, aSpyBuilder, buildCube } from '@/regen/testing';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import { createFakeSolver, rectangleData } from '@/sketch/testing';
import { createAppSession } from './index';
import { RESTART_LIMIT } from './kernel-supervisor';
import type { AppSession, AppSessionDeps, KernelUiState, ViewCubeLabels } from './index';
import { importDocumentFile } from './documents';
import type { DownloadFile } from './file-exporter';
import {
  aDownloads,
  aKernelFactory,
  createCrashableKernel,
  FakeAppViewport,
  settle,
} from './testing';
import type { CrashableKernel, KernelFactory } from './testing';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;
const UNTITLED = 'Bez názvu';

/** Czech texts of the box plus the name of a new document. */
function translate(key: string): string {
  if (key === 'document.untitled') return UNTITLED;
  return boxPlugin.messages?.cs[key] ?? key;
}

interface Harness {
  readonly session: AppSession;
  readonly store: DocumentStore;
  readonly kernels: KernelFactory;
  readonly viewport: FakeAppViewport;
  readonly scheduler: ManualScheduler;
  /** Files downloaded through the session (M15). */
  readonly downloads: readonly DownloadFile[];
  /** Moves the monotonic clock (the restart window of the kernel, M19.1). */
  readonly advance: (ms: number) => void;
}

async function open(
  overrides: Partial<AppSessionDeps> & { kernels?: KernelFactory } = {},
): Promise<Harness> {
  const store = overrides.store ?? createMemoryDocumentStore({ now: () => 0 });
  const kernels = overrides.kernels ?? aKernelFactory();
  const viewport = new FakeAppViewport();
  const scheduler = createManualScheduler();
  const downloads = aDownloads();
  let monotonic = 0;
  const session = await createAppSession({
    plugins: [boxPlugin],
    store,
    docId: DOC,
    createKernel: kernels.create,
    viewport,
    scheduler,
    now: () => 1_000_000,
    monotonic: () => monotonic,
    ids: createSequentialIdGenerator('f'),
    translate,
    confirm: () => true,
    readOnly: false,
    solver: createFakeSolver(),
    download: downloads.download,
    theme: 'light',
    ...overrides,
  });
  await settle();
  return {
    session,
    store,
    kernels,
    viewport,
    scheduler,
    downloads: downloads.files,
    advance: (ms) => {
      monotonic += ms;
    },
  };
}

/** Deps of a session without the harness, for tests that call createAppSession themselves. */
function sessionDeps(kernels: KernelFactory): AppSessionDeps {
  return {
    plugins: [boxPlugin],
    store: createMemoryDocumentStore({ now: () => 0 }),
    docId: DOC,
    createKernel: kernels.create,
    viewport: new FakeAppViewport(),
    scheduler: createManualScheduler(),
    now: () => 0,
    monotonic: () => 0,
    ids: createSequentialIdGenerator('f'),
    translate,
    confirm: () => true,
    readOnly: false,
    solver: createFakeSolver(),
    download: () => undefined,
    theme: 'light',
  };
}

/** A plugin whose feature leaves an artifact that is not a body: a sketch without regions. */
const markPlugin: FeaturePlugin = {
  schema: aSchema('mark'),
  builder: aSpyBuilder('mark', ({ feature, state }) => {
    const mark = aSketchArtifact(feature.id);
    return Promise.resolve({
      ok: true,
      state: { artifacts: new Map(state.artifacts).set(mark.id, mark) },
    });
  }),
};

/** A feature that refers to bodies and builds nothing (not the real Boolean). */
const usePlugin: FeaturePlugin = {
  schema: {
    type: 'use',
    version: 1,
    label: 'use',
    params: { bodies: { kind: 'bodies', label: 'Bodies' } },
    defaults: () => ({ bodies: [] }),
    validate: () => [],
  },
  builder: aSpyBuilder('use', ({ state }) => Promise.resolve({ ok: true, state })),
};

/** Creates a box through the dialog with the given height and commits it. */
function addBox(session: AppSession, height = 10): void {
  const edit = session.features.create('box');
  edit.setParam('height', height);
  edit.commit();
}

/** A stored document with one box, made and saved by a first session. */
async function aStoredDocumentWithBox(): Promise<DocumentStore> {
  const { session, store, scheduler } = await open();
  addBox(session, 20);
  scheduler.advance(1000);
  await settle();
  session.dispose();
  await settle();
  return store;
}

const key = (k: string): ViewKeyEvent => ({
  key: k,
  mods: { shift: false, alt: false, mod: false },
  inTextField: false,
});

describe('createAppSession – opening', () => {
  it('hands its models without dispose: the session disposes them (ADR 0011)', () => {
    expectTypeOf<AppSession['topoInspector']>().not.toHaveProperty('dispose');
    expectTypeOf<AppSession['history']>().not.toHaveProperty('dispose');
    expectTypeOf<AppSession['files']>().not.toHaveProperty('dispose');
  });

  it('creates a missing document in the store, empty and named by translate', async () => {
    const { session, store } = await open();
    expect(session.doc.meta.id).toBe(DOC);
    expect(session.doc.meta.name).toBe(UNTITLED);
    expect(session.doc.studio.features).toEqual([]);
    expect(session.readOnly).toBe(false);
    const infos = await store.listDocuments();
    expect(infos.map((i) => i.meta.id)).toEqual([DOC]);
  });

  it('starts the kernel and regenerates the empty document', async () => {
    const { session, kernels } = await open();
    expect(kernels.kernels).toHaveLength(1);
    expect(session.kernel.get()).toBe('ready');
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 0 });
    // D6 of M19.2: the error count comes from the feature tree, which knows a draft.
    expect(session.regen.get()).not.toHaveProperty('errorCount');
    expect(session.featureTree.errorCount.get()).toBe(0);
  });

  it('opens a stored document and shows its bodies', async () => {
    const store = await aStoredDocumentWithBox();
    const { session, viewport } = await open({ store });
    expect(session.doc.studio.features).toHaveLength(1);
    expect(session.featureTree.rows.get()).toHaveLength(1);
    expect(viewport.lastSync).toHaveLength(1);
    expect(session.regen.get().bodyCount).toBe(1);
  });

  it('rejects a document the store holds broken data for', async () => {
    const store = createMemoryDocumentStore();
    const broken: DocumentStore = {
      listDocuments: () => store.listDocuments(),
      createDocument: (meta, initial) => store.createDocument(meta, initial),
      deleteDocument: (id) => store.deleteDocument(id),
      appendEntries: (id, entries) => store.appendEntries(id, entries),
      saveSnapshot: (id, snapshot) => store.saveSnapshot(id, snapshot),
      load: () => Promise.resolve({ snapshot: {}, base: {}, entries: [] }),
    };
    await expect(open({ store: broken })).rejects.toThrow(/doc1/);
  });

  it('exposes every tool, the select tool active, and the merged plugin messages', async () => {
    const { session } = await open();
    // The tools of the sketcher come after the tools of the plugins (spec 11, "Skicář").
    expect(session.toolList.map((t) => t.id)).toEqual([
      'select',
      'box',
      'sketch',
      'sketch.select',
      'sketch.line',
      'sketch.rectangle',
      'sketch.circle',
      'sketch.arc',
      'sketch.dimension',
    ]);
    expect(session.tools.active.get()).toBe('select');
    expect(session.messages.cs['box.label']).toBe(boxPlugin.messages?.cs['box.label']);
    expect(session.messages.en['box.label']).toBe(boxPlugin.messages?.en['box.label']);
  });

  it('rejects two plugins of the same type before anything starts', async () => {
    const kernels = aKernelFactory();
    await expect(open({ plugins: [boxPlugin, boxPlugin], kernels })).rejects.toThrow(/box/);
    expect(kernels.kernels).toHaveLength(0);
  });
});

describe('createAppSession – verify', () => {
  /** The stored box document with a snapshot at seq 1 that does not match its log. */
  async function aDocumentWithForeignSnapshot(): Promise<DocumentStore> {
    const store = await aStoredDocumentWithBox();
    // A snapshot of an empty document at seq 1: the log says there is a box.
    const meta = { id: DOC, name: UNTITLED, createdAt: 0 };
    await store.saveSnapshot(DOC, createSnapshot(createDocument({ meta }), 1));
    return store;
  }

  it('hands verify to loadDocument: a snapshot that disagrees with the log fails to open', async () => {
    const store = await aDocumentWithForeignSnapshot();
    await expect(open({ store, verify: true })).rejects.toThrow(/not deterministic/);
  });

  it('without verify the same document opens from the snapshot', async () => {
    const store = await aDocumentWithForeignSnapshot();
    const { session } = await open({ store });
    expect(session.doc.studio.features).toHaveLength(0);
  });
});

describe('createAppSession – changes', () => {
  it('a committed box is regenerated and synced to the viewport', async () => {
    const { session, viewport } = await open();
    addBox(session, 30);
    await settle();
    expect(viewport.lastSync).toHaveLength(1);
    const regen = session.regen.get();
    expect(regen).toMatchObject({ busy: false, bodyCount: 1 });
    expect(session.featureTree.errorCount.get()).toBe(0);
    expect(regen.lastMs).not.toBeNull();
    expect(session.browser.bodies.get()).toHaveLength(1);
    expect(session.featureTree.rows.get()[0]?.status).toBe('ok');
  });

  it('the browser lists a body with its origin as the feature that made it', async () => {
    const { session } = await open();
    addBox(session);
    await settle();
    const id = session.doc.studio.features[0]?.id ?? fail();
    expect(session.browser.bodies.get().map(({ body, feature }) => ({ body, feature }))).toEqual([
      { body: bodyId(id), feature: id },
    ]);
  });

  it('only bodies reach bodyCount, the viewport and the browser; other artifacts do not', async () => {
    const { session, viewport } = await open({ plugins: [boxPlugin, markPlugin] });
    addBox(session);
    session.features.create('mark').commit();
    await settle();
    const box = session.doc.studio.features[0]?.id ?? fail();
    expect(session.regen.get()).toMatchObject({ bodyCount: 1 });
    expect(session.featureTree.errorCount.get()).toBe(0);
    expect(viewport.lastSync.map((b) => b.id)).toEqual([bodyId(box)]);
    expect(session.browser.bodies.get().map((r) => r.body)).toEqual([bodyId(box)]);
  });

  it('ten quick changes regenerate at most twice and show the last height', async () => {
    const { session, viewport, kernels } = await open();
    addBox(session);
    await settle();
    const syncsBefore = viewport.syncs.length;
    const boxesBefore = kernels.last.fake.callCount('makeBox');

    const edit = session.features.edit(session.doc.studio.features[0]?.id ?? fail());
    for (let h = 11; h <= 20; h++) edit.setParam('height', h);
    await settle();
    edit.commit();
    await settle();

    // At least one run, so no run at all (or only a stale one) does not pass (revize, testy T3).
    const syncs = viewport.syncs.length - syncsBefore;
    expect(syncs).toBeGreaterThanOrEqual(1);
    expect(syncs).toBeLessThanOrEqual(2);
    const boxes = kernels.last.fake.callCount('makeBox') - boxesBefore;
    expect(boxes).toBeGreaterThanOrEqual(1);
    expect(boxes).toBeLessThanOrEqual(2);
    expect(session.regen.get().busy).toBe(false);
    const shown = viewport.shown[0]?.shape ?? fail();
    const { min, max } = await kernels.last.fake.boundingBox(shown);
    expect(max[2] - min[2]).toBe(20);
  });

  it('busy is true while a regeneration runs', async () => {
    const { session } = await open();
    const seen: boolean[] = [];
    session.regen.subscribe(() => seen.push(session.regen.get().busy));
    addBox(session);
    expect(session.regen.get().busy).toBe(true);
    await settle();
    expect(seen[seen.length - 1]).toBe(false);
  });

  it('an invalid param marks only its feature, the other bodies stay', async () => {
    const { session, viewport } = await open();
    addBox(session, 10);
    addBox(session, 0);
    await settle();
    expect(session.regen.get()).toMatchObject({ bodyCount: 1 });
    expect(session.featureTree.errorCount.get()).toBe(1);
    expect(viewport.lastSync).toHaveLength(1);
    expect(session.featureTree.rows.get().map((r) => r.status)).toEqual(['ok', 'error']);
  });

  it('saves the log to the store after the flush delay', async () => {
    const { session, store, scheduler } = await open();
    addBox(session);
    expect(session.persistence.get()).toBe('pending');
    scheduler.advance(1000);
    await settle();
    expect(session.persistence.get()).toBe('saved');
    expect((await store.load(DOC))?.entries).toHaveLength(1);
  });

  it('flush writes the pending queue to the store at once, without the delay', async () => {
    const { session, store, scheduler } = await open();
    addBox(session);
    await session.flush();
    expect(session.persistence.get()).toBe('saved');
    expect((await store.load(DOC))?.entries).toHaveLength(1);
    // The delayed flush is cancelled: nothing is written twice.
    expect(scheduler.pending).toBe(0);
  });
});

describe('createAppSession – generation and errors of a regeneration (M19.1)', () => {
  const idsOf = (bodies: readonly { readonly id: BodyId }[]): BodyId[] => bodies.map((b) => b.id);
  /** The bodies of the snapshot in the port, as the browser lists them. */
  const portBodies = (session: AppSession): BodyId[] =>
    session.browser.bodies.get().map((row) => row.body);

  /** A feature whose builder throws (a bug, not a kernel error) while `broken()`. */
  const aFragilePlugin = (broken: () => boolean): FeaturePlugin => ({
    schema: aSchema('fragile'),
    builder: aSpyBuilder('fragile', (input, ctx) =>
      broken() ? Promise.reject(new Error('builder bug')) : buildCube(input, ctx),
    ),
  });

  it('publishes the snapshot only once the view shows the bodies of the same generation (D3)', async () => {
    const { session, viewport } = await open();
    viewport.holdSyncs();
    addBox(session, 10);
    await settle();
    // The regeneration finished, the view still tessellates: nothing of it is published yet.
    expect(viewport.heldSyncs).toBe(1);
    expect(portBodies(session)).toEqual([]);
    expect(session.regen.get()).toMatchObject({ busy: true, bodyCount: 0 });
    expect(viewport.fitAllCount).toBe(0);

    viewport.releaseSyncs();
    await settle();
    const first = bodyId(session.doc.studio.features[0]?.id ?? fail());
    expect(portBodies(session)).toEqual([first]);
    expect(idsOf(viewport.shown)).toEqual([first]);
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 1 });
    // A new document: its empty first regeneration decided the first view (D7 of M19.2).
    expect(viewport.fitAllCount).toBe(0);

    viewport.holdSyncs();
    addBox(session, 20);
    await settle();
    // The port keeps the generation the view shows, so a picked index and the names agree (C6).
    expect(portBodies(session)).toEqual([first]);
    expect(idsOf(viewport.shown)).toEqual(portBodies(session));

    viewport.releaseSyncs();
    await settle();
    const second = bodyId(session.doc.studio.features[1]?.id ?? fail());
    expect(portBodies(session)).toEqual([first, second]);
    expect(idsOf(viewport.shown)).toEqual(portBodies(session));
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 2 });
  });

  it('the sketches of a regeneration are drawn only once its bodies are shown', async () => {
    const { session, viewport } = await open({ plugins: [boxPlugin, sketchPlugin] });
    viewport.holdSyncs();
    expect(session.actions.run(session.toolActionId('sketch'))).toBe(true);
    const feature = session.sketches.current.get()?.featureId ?? fail();
    session.actions.run(session.sketchActionIds.finish);
    await settle();
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(false);

    viewport.releaseSyncs();
    await settle();
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(true);
  });

  it('a kernel restart during a held sync drops its result: the port never gets it', async () => {
    const { session, viewport, kernels } = await open();
    addBox(session, 10);
    await settle();
    const first = bodyId(session.doc.studio.features[0]?.id ?? fail());
    const published: BodyId[][] = [];
    session.browser.bodies.subscribe(() => published.push(portBodies(session)));

    viewport.holdSyncs();
    addBox(session, 20);
    await settle();
    expect(viewport.heldSyncs).toBe(1);
    const crashed = kernels.last;
    crashed.crash();
    await settle();
    // The new kernel reset the view, so the held sync settled stale; its result belongs to the
    // dead kernel. The catch-up run over the new kernel waits in a sync of its own.
    expect(session.kernel.get()).toBe('ready');
    expect(kernels.last).not.toBe(crashed);
    expect(viewport.heldSyncs).toBe(1);
    expect(published).toEqual([]);
    expect(portBodies(session)).toEqual([first]);

    viewport.releaseSyncs();
    await settle();
    expect(published).toHaveLength(1);
    expect(portBodies(session)).toHaveLength(2);
    expect(idsOf(viewport.shown)).toEqual(portBodies(session));
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 2, failed: null });
  });

  it('the result of a kernel that died after its last call sends no tessellation', async () => {
    let crash: (() => void) | null = null;
    const doomed: FeaturePlugin = {
      schema: aSchema('doomed'),
      // The kernel dies once the build is done: the run still ends with a result.
      builder: aSpyBuilder('doomed', async (input, ctx) => {
        const output = await buildCube(input, ctx);
        crash?.();
        crash = null;
        return output;
      }),
    };
    const { session, viewport, kernels } = await open({ plugins: [doomed] });
    const syncs = viewport.syncs.length;
    const first = kernels.last;
    crash = () => {
      first.crash();
    };
    session.features.create('doomed').commit();
    await settle();
    expect(first.disposed).toBe(true);
    expect(kernels.last).not.toBe(first);
    // Only the catch-up run over the new kernel reaches the view, after its reset.
    expect(viewport.syncs).toHaveLength(syncs + 1);
    expect(viewport.resets[viewport.resets.length - 1]).toBe(kernels.last);
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 1, failed: null });
  });

  it('a builder that throws sets failed; the next successful regeneration clears it', async () => {
    let broken = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session } = await open({ plugins: [boxPlugin, aFragilePlugin(() => broken)] });
    expect(session.regen.get().failed).toBeNull();

    session.features.create('fragile').commit();
    await settle();
    expect(session.regen.get()).toMatchObject({ busy: false, failed: 'builder bug' });
    // Still reported, not only shown.
    expect(errors).toHaveBeenCalledWith(new Error('builder bug'));

    broken = false;
    addBox(session);
    await settle();
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 2, failed: null });
    errors.mockRestore();
  });

  it('a kernel lost during a regeneration is a restart, not a failed regeneration', async () => {
    const { session, kernels } = await open();
    addBox(session);
    // The run is under way: the kernel dies before it ends.
    kernels.last.crash();
    await settle();
    expect(session.kernel.get()).toBe('ready');
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 1, failed: null });
  });

  it('a subscriber of the port that throws does not stop the step; it is reported after it', async () => {
    const { session, viewport } = await open();
    // What was done of the step when the error was reported.
    const reported: { error: unknown; fitAll: number; bodyCount: number }[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation((error: unknown) => {
      reported.push({
        error,
        fitAll: viewport.fitAllCount,
        bodyCount: session.regen.get().bodyCount,
      });
    });
    const bug = new Error('subscriber bug');
    session.browser.bodies.subscribe(() => {
      throw bug;
    });

    addBox(session);
    await settle();
    const body = bodyId(session.doc.studio.features[0]?.id ?? fail());
    expect(idsOf(viewport.shown)).toEqual([body]);
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 1, failed: null });
    // A new document is not fitted (D7 of M19.2); the order of the first view is tested there.
    expect(viewport.fitAllCount).toBe(0);
    // After the whole step: the counters were done already.
    expect(reported).toEqual([{ error: bug, fitAll: 0, bodyCount: 1 }]);
    errors.mockRestore();
  });
});

describe('createAppSession – kernel restart', () => {
  it('a crashed kernel is replaced: restarting → ready, bodies shown again', async () => {
    const { session, kernels, viewport } = await open();
    addBox(session);
    await settle();
    const states: KernelUiState[] = [];
    session.kernel.subscribe(() => states.push(session.kernel.get()));
    const crashed = kernels.last;

    crashed.crash();
    addBox(session);
    await settle();

    expect(states).toEqual(['restarting', 'ready']);
    expect(crashed.disposed).toBe(true);
    expect(kernels.kernels).toHaveLength(2);
    expect(viewport.resets[viewport.resets.length - 1]).toBe(kernels.last);
    expect(viewport.lastSync).toHaveLength(2);
    expect(session.regen.get().bodyCount).toBe(2);
  });

  it('a crash during a tessellation of the viewport restarts the kernel and shows the bodies again', async () => {
    const { session, kernels, viewport } = await open();
    addBox(session);
    await settle();
    const states: KernelUiState[] = [];
    session.kernel.subscribe(() => states.push(session.kernel.get()));
    const crashed = kernels.last;
    const syncs = viewport.syncs.length;
    const body = viewport.lastSync[0] ?? fail();

    // The viewport tessellates through the kernel app handed it (bodies.reset); the worker dies
    // meanwhile. No regeneration runs and the document does not change (revize C7).
    const meshes = viewport.resets[viewport.resets.length - 1] ?? fail();
    const tessellation = meshes
      .tessellate(body.shape, { linearDeflection: 0.1, angularDeflection: 0.5 })
      .catch((e: unknown) => e);
    crashed.crash('OCCT crashed: unreachable');
    await settle();

    expect(await tessellation).toMatchObject({ code: 'disconnected' });
    expect(states).toEqual(['restarting', 'ready']);
    expect(crashed.disposed).toBe(true);
    expect(viewport.resets[viewport.resets.length - 1]).toBe(kernels.last);
    expect(viewport.syncs).toHaveLength(syncs + 1);
    expect(viewport.lastSync.map((b) => b.id)).toEqual([body.id]);
    expect(kernels.last.fake.callCount('makeBox')).toBe(1);
    expect(session.doc.studio.features).toHaveLength(1);
  });

  it('crashes over the limit → failed with the cause; retryKernel starts the kernel again', async () => {
    const { session, kernels, viewport } = await open();
    addBox(session);
    await settle();
    for (let i = 0; i < RESTART_LIMIT; i++) {
      kernels.last.crash();
      await settle();
      expect(session.kernel.get()).toBe('ready');
    }
    kernels.last.crash('OCCT crashed: memory access out of bounds');
    await settle();
    expect(session.kernel.get()).toBe('failed');
    expect(session.kernelError.get()).toBe('OCCT crashed: memory access out of bounds');
    expect(kernels.kernels).toHaveLength(RESTART_LIMIT + 1);

    session.retryKernel();
    expect(session.kernel.get()).toBe('starting');
    await settle();
    expect(session.kernel.get()).toBe('ready');
    expect(session.kernelError.get()).toBeNull();
    expect(viewport.resets[viewport.resets.length - 1]).toBe(kernels.last);
    expect(viewport.lastSync).toHaveLength(1);
  });

  it('after a restart the STEP export sends no handle of the old kernel', async () => {
    // A feature whose builder breaks (a bug, not a kernel error) once the kernel was restarted:
    // the regeneration over the new kernel never finishes, so the last state is the old one.
    let broken = false;
    const fragile: FeaturePlugin = {
      schema: aSchema('fragile'),
      builder: aSpyBuilder('fragile', (input, ctx) =>
        broken ? Promise.reject(new Error('builder bug')) : buildCube(input, ctx),
      ),
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, kernels, downloads } = await open({ plugins: [fragile] });
    session.features.create('fragile').commit();
    await settle();
    expect(session.regen.get().bodyCount).toBe(1);

    broken = true;
    kernels.last.crash();
    await settle();
    expect(session.kernel.get()).toBe('ready');
    expect(errors).toHaveBeenCalledWith(new Error('builder bug'));

    expect(session.actions.run(session.fileActionIds.exportStep)).toBe(true);
    await settle();
    // The handles of the old kernel mean other shapes, or nothing, in the new one (revize AF13).
    expect(kernels.last.fake.callCount('exportStep')).toBe(0);
    expect(downloads).toEqual([]);
    expect(session.files.status.get()).toMatchObject({ kind: 'failed', task: 'step' });
    errors.mockRestore();
  });

  it('an error while a ready kernel is wired goes to reportError, not to an unhandled rejection', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const viewport = new FakeAppViewport();
    const failure = new Error('reset failed');
    viewport.bodies.reset = () => {
      throw failure;
    };
    const session = await createAppSession({ ...sessionDeps(aKernelFactory()), viewport });
    await settle();
    expect(session.kernel.get()).toBe('ready');
    expect(errors).toHaveBeenCalledWith(failure);
    errors.mockRestore();
  });

  it('starts the kernel only once the session is built: a failing step leaves no worker', async () => {
    const kernels = aKernelFactory();
    const viewport = new FakeAppViewport();
    const deps = { ...sessionDeps(kernels), viewport };
    // The theme is read by the last step of the construction (the default body colour).
    Object.defineProperty(deps, 'theme', {
      get: () => {
        throw new Error('step failed');
      },
    });
    await expect(createAppSession(deps)).rejects.toThrow('step failed');
    await settle();
    expect(kernels.kernels).toHaveLength(0);
    // What the steps built is released: keys of the view reach no action (fit all is F).
    viewport.emitKey(key('f'));
    expect(viewport.fitAllCount).toBe(0);
  });

  it('a kernel that fails to start → unavailable, kernelError carries its text', async () => {
    const kernels = aKernelFactory();
    kernels.failNext(new Error('OCCT worker failed: SyntaxError'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, viewport } = await open({ kernels });
    expect(session.kernel.get()).toBe('unavailable');
    expect(session.kernelError.get()).toBe('OCCT worker failed: SyntaxError');
    expect(viewport.resets).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('kernelError is null while the kernel runs', async () => {
    const { session } = await open();
    expect(session.kernel.get()).toBe('ready');
    expect(session.kernelError.get()).toBeNull();
  });
});

describe('createAppSession – read-only', () => {
  it('writes nothing and refuses changes of the document', async () => {
    const store = await aStoredDocumentWithBox();
    const append = vi.spyOn(store, 'appendEntries');
    const snapshot = vi.spyOn(store, 'saveSnapshot');
    const { session, scheduler, viewport } = await open({ store, readOnly: true });

    expect(session.readOnly).toBe(true);
    expect(viewport.lastSync).toHaveLength(1);
    expect(() => session.features.create('box')).toThrow(/read-only/);
    expect(() => {
      session.tools.activate('box');
    }).toThrow(/read-only/);
    const id = session.doc.studio.features[0]?.id ?? fail();
    const name = session.doc.feature(id)?.name;
    // The tree holds the edit lock itself: read-only, its command does nothing (M19.1).
    session.featureTree.rename(id, 'Other');
    expect(session.doc.feature(id)?.name).toBe(name);

    scheduler.advance(10_000);
    session.dispose();
    await settle();
    expect(session.persistence.get()).toBe('saved');
    expect(append).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('flush writes nothing', async () => {
    const store = await aStoredDocumentWithBox();
    const counting = aCountingStore(store);
    const snapshot = vi.spyOn(store, 'saveSnapshot');
    const { session } = await open({ store: counting.store, readOnly: true });
    await expect(session.flush()).resolves.toBeUndefined();
    expect(counting.appends()).toBe(0);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('does not create a missing document', async () => {
    const store = createMemoryDocumentStore();
    await expect(open({ store, readOnly: true })).rejects.toThrow(/doc1/);
    expect(await store.listDocuments()).toEqual([]);
  });
});

describe('createAppSession – view', () => {
  it('setTheme picks the scene palette', async () => {
    const { session, viewport } = await open();
    session.setTheme('dark');
    expect(viewport.palette).toBe(DARK_PALETTE);
    session.setTheme('light');
    expect(viewport.palette).toBe(LIGHT_PALETTE);
  });

  it('setViewCubeLabels hands the labels to the viewport unchanged (M17)', async () => {
    const { session, viewport } = await open();
    const labels: ViewCubeLabels = {
      front: 'Přední',
      back: 'Zadní',
      left: 'Levá',
      right: 'Pravá',
      top: 'Horní',
      bottom: 'Dolní',
      turnLeft: 'Otočit doleva',
      turnRight: 'Otočit doprava',
      turnUp: 'Otočit nahoru',
      turnDown: 'Otočit dolů',
      rollClockwise: 'Natočit po směru hodinových ručiček',
      rollCounterClockwise: 'Natočit proti směru hodinových ručiček',
      switchToFree: 'Přepnout na volné otáčení',
      switchToTurntable: 'Přepnout na otáčení se svislou osou Z',
    };
    session.setViewCubeLabels(labels);
    expect(viewport.viewCubeLabels).toEqual([labels]);
    expect(viewport.viewCubeLabels[0]).toBe(labels);
  });

  it('setOrbitMode hands the mode to the viewport (M17.1)', async () => {
    const { session, viewport } = await open();
    session.setOrbitMode('free');
    session.setOrbitMode('turntable');
    expect(viewport.orbitModes).toEqual(['free', 'turntable']);
  });

  it('a toggle request of the viewport reaches the session listener until unsubscribed (M17.1)', async () => {
    const { session, viewport } = await open();
    let toggles = 0;
    const off = session.onOrbitModeToggle(() => {
      toggles++;
    });
    viewport.emitOrbitModeToggle();
    expect(toggles).toBe(1);
    off();
    viewport.emitOrbitModeToggle();
    expect(toggles).toBe(1);
  });

  it('hiding a body in the browser hides it in the viewport, showing shows it', async () => {
    const { session, viewport } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setVisible(body, false);
    expect(viewport.visibilityCalls).toContainEqual({ body, visible: false });
    session.browser.setVisible(body, true);
    expect(viewport.visibilityCalls[viewport.visibilityCalls.length - 1]).toEqual({
      body,
      visible: true,
    });
  });

  it('a hidden body stays hidden after the next sync', async () => {
    const { session, viewport } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setVisible(body, false);
    viewport.visibilityCalls.length = 0;
    addBox(session);
    await settle();
    expect(viewport.visibilityCalls).toContainEqual({ body, visible: false });
  });

  it('the browser stores hiding in the document, so it survives a reopen', async () => {
    const { session, store } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setVisible(body, false);
    expect(session.doc.bodyMeta(body)).toEqual({ hidden: true });
    await session.close();

    const reopened = await open({ store });
    expect(reopened.session.browser.bodies.get()[0]).toMatchObject({ body, visible: false });
    expect(reopened.viewport.visibilityCalls).toContainEqual({ body, visible: false });
  });

  it('mountViewport mounts the viewport', async () => {
    const { session, viewport } = await open();
    // A stand-in element: the fake only records what it got.
    const el = {} as HTMLElement;
    session.mountViewport(el);
    expect(viewport.mountedOn).toBe(el);
  });

  it('mirrors the selection into the viewport highlight', async () => {
    const { session, viewport } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.selection.set([{ kind: 'face', body, faceIndex: 2 }]);
    expect(viewport.selection).toEqual([{ kind: 'face', body, faceIndex: 2 }]);
  });

  it('keys the active tool does not handle go to the actions', async () => {
    const { session, viewport } = await open();
    const run = vi.fn();
    session.actions.register({
      id: 'test.x',
      label: 'test.x',
      shortcut: 'X',
      enabled: { get: () => true, subscribe: () => () => undefined },
      run,
    });
    viewport.emitKey(key('x'));
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('createAppSession – actions', () => {
  // The rules of the actions are tested in interaction (builtin-actions.test.ts); here only that
  // app registers them over the session and hands ui the lock and the ids.

  it('registers the built-in actions and an action per tool with a shortcut', async () => {
    const { session } = await open();
    const ids = session.actions.actions.get().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(Object.values(session.actionIds)));
    expect(session.actions.actions.get().find((a) => a.id === 'tool.box')).toMatchObject({
      label: 'box.label',
      shortcut: 'B',
    });
  });

  it('actionIds are the ids of the built-in actions', async () => {
    const { session } = await open();
    expect(session.actionIds.undo).toBe('undo');
    expect(session.actionIds.featureRename).toBe('feature.rename');
  });

  it('locked follows the feature dialog', async () => {
    const { session } = await open();
    expect(session.locked.get()).toBe(false);
    const edit = session.features.create('box');
    expect(session.locked.get()).toBe(true);
    edit.cancel();
    expect(session.locked.get()).toBe(false);
  });

  it('read-only is locked and disables the actions that change the document', async () => {
    const store = await aStoredDocumentWithBox();
    const { session } = await open({ store, readOnly: true });
    const enabled = (id: string): boolean | undefined =>
      session.actions.actions.get().find((a) => a.id === id)?.enabled;
    expect(session.locked.get()).toBe(true);
    expect(enabled(session.actionIds.toStart)).toBe(false);
    expect(enabled('tool.box')).toBe(false);
    expect(enabled(session.actionIds.fitAll)).toBe(true);
  });

  it('undo through the keyboard brings the document back', async () => {
    const { session, viewport } = await open();
    addBox(session);
    viewport.emitKey({ ...key('z'), mods: { shift: false, alt: false, mod: true } });
    expect(session.doc.studio.features).toHaveLength(0);
  });

  it('feature.delete asks the confirm of the deps before features lose a reference', async () => {
    const asked: ConfirmRequest[] = [];
    const { session } = await open({
      plugins: [boxPlugin, usePlugin],
      confirm: (request) => {
        asked.push(request);
        return false;
      },
    });
    addBox(session);
    const box = session.doc.studio.features[0]?.id;
    if (box === undefined) expect.fail('No box');
    const use = session.features.create('use');
    use.setParam('bodies', [{ kind: 'body', body: bodyId(box) }]);
    use.commit();

    session.selection.set([{ kind: 'feature', feature: box }]);
    session.actions.run(session.actionIds.featureDelete);
    expect(asked).toEqual([{ key: 'feature.delete.confirm', params: { n: 1 } }]);
    expect(session.doc.studio.features).toHaveLength(2);
  });

  it('fit all fits the camera of the viewport', async () => {
    const { session, viewport } = await open();
    const before = viewport.fitAllCount;
    session.actions.run(session.actionIds.fitAll);
    expect(viewport.fitAllCount).toBe(before + 1);
  });
});

describe('createAppSession – first view', () => {
  // D7 (M19.2): the first finished regeneration after opening decides; later ones never move
  // the camera.
  /** Ids of a reopened session, apart from the ones of the session that stored the document. */
  const reopenedIds = () => createSequentialIdGenerator('g');

  it('a stored document with a box is fitted once; a later change does not move the camera', async () => {
    const store = await aStoredDocumentWithBox();
    const { session, viewport } = await open({ store, ids: reopenedIds() });
    expect(viewport.fitAllCount).toBe(1);
    addBox(session);
    await settle();
    expect(viewport.fitAllCount).toBe(1);
  });

  it('a new document is never fitted: the first regeneration has no body', async () => {
    const { session, viewport } = await open();
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 0 });
    addBox(session);
    await settle();
    expect(session.regen.get().bodyCount).toBe(1);
    expect(viewport.fitAllCount).toBe(0);
  });

  it('fits only once the view shows the bodies of the first regeneration', async () => {
    const store = await aStoredDocumentWithBox();
    const viewport = new FakeAppViewport();
    viewport.holdSyncs();
    await open({ store, ids: reopenedIds(), viewport });
    expect(viewport.heldSyncs).toBe(1);
    expect(viewport.fitAllCount).toBe(0);
    viewport.releaseSyncs();
    await settle();
    expect(viewport.shown).toHaveLength(1);
    expect(viewport.fitAllCount).toBe(1);
  });

  it('a kernel restart does not decide again', async () => {
    const store = await aStoredDocumentWithBox();
    const { session, kernels, viewport } = await open({ store, ids: reopenedIds() });
    kernels.last.crash();
    addBox(session);
    await settle();
    expect(kernels.kernels).toHaveLength(2);
    expect(session.regen.get().bodyCount).toBe(2);
    expect(viewport.fitAllCount).toBe(1);
  });

  it('a regeneration that throws does not decide; the next successful one does', async () => {
    let broken = false;
    const plugins = [
      boxPlugin,
      {
        schema: aSchema('fragile'),
        builder: aSpyBuilder('fragile', (input, ctx) =>
          broken ? Promise.reject(new Error('builder bug')) : buildCube(input, ctx),
        ),
      },
    ];
    const first = await open({ plugins });
    first.session.features.create('fragile').commit();
    first.scheduler.advance(1000);
    await settle();
    first.session.dispose();
    await settle();

    broken = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, viewport } = await open({ plugins, store: first.store, ids: reopenedIds() });
    expect(session.regen.get().failed).toBe('builder bug');
    expect(viewport.fitAllCount).toBe(0);

    broken = false;
    addBox(session);
    await settle();
    expect(session.regen.get()).toMatchObject({ bodyCount: 2, failed: null });
    expect(viewport.fitAllCount).toBe(1);
    errors.mockRestore();
  });
});

describe('createAppSession – sketcher', () => {
  /** A session with the sketch plugin; `sketch` opens a new sketch through the entry tool. */
  async function openSketcher(): Promise<Harness> {
    return open({ plugins: [boxPlugin, sketchPlugin] });
  }

  function enterSketch(session: AppSession): void {
    expect(session.actions.run(session.toolActionId('sketch'))).toBe(true);
  }

  /** The open sketch session; fails the test without one. */
  function currentSketch(session: AppSession) {
    return session.sketches.current.get() ?? fail();
  }

  it('toolModes gives the modes of a tool, the select tool the default model', async () => {
    const { session } = await openSketcher();
    const modes = new Map(session.toolList.map((tool) => [tool.id, session.toolModes(tool)]));
    expect(modes.get('select')).toEqual(['model']);
    expect(modes.get('sketch')).toEqual(['model']);
    expect(modes.get('sketch.select')).toEqual(['sketch']);
    expect(modes.get('sketch.line')).toEqual(['sketch']);
  });

  it('the tool sketch enters the sketch mode: camera normal to XY, sketch.select active', async () => {
    const { session, viewport } = await openSketcher();
    expect(session.mode.get()).toBe('model');
    enterSketch(session);
    expect(session.mode.get()).toBe('sketch');
    expect(viewport.viewDirections.at(-1)).toEqual([0, 0, 1]);
    expect(session.tools.active.get()).toBe('sketch.select');
    expect(session.sketchActionIds.finish).toBe('sketch.finish');
    expect(session.sketchConstraintActionId('horizontal')).toBe('sketch.constraint.horizontal');
  });

  it('sketch.finish goes back to the model mode with one entry in the log', async () => {
    const { session, store, scheduler } = await openSketcher();
    enterSketch(session);
    await currentSketch(session).addGeometry(rectangleData({ width: 40, height: 20 }));
    expect(session.actions.run(session.sketchActionIds.finish)).toBe(true);
    expect(session.mode.get()).toBe('model');
    expect(session.tools.active.get()).toBe('select');
    expect(session.doc.studio.features.map((f) => f.type)).toEqual(['sketch']);
    scheduler.advance(1000);
    await settle();
    expect((await store.load(DOC))?.entries).toHaveLength(1);
  });

  it('the tools of the sketch mode and the sketch actions are registered', async () => {
    const { session } = await openSketcher();
    const tools = session.toolList.map((t) => t.id);
    expect(tools).toEqual(
      expect.arrayContaining(['sketch', 'sketch.select', 'sketch.line', 'sketch.dimension']),
    );
    // After the tools of the plugins.
    expect(tools.indexOf('sketch')).toBeGreaterThan(tools.indexOf('box'));
    const actions = session.actions.actions.get().map((a) => a.id);
    expect(actions).toEqual(
      expect.arrayContaining([
        'sketch.finish',
        'sketch.cancel',
        'sketch.delete',
        'sketch.constraint.horizontal',
      ]),
    );
  });

  it('a regenerated sketch is drawn under its id, but not while it is being edited', async () => {
    const { session, viewport } = await openSketcher();
    enterSketch(session);
    const feature: FeatureId = currentSketch(session).featureId;
    await currentSketch(session).addGeometry(rectangleData({ width: 40, height: 20 }));
    await settle();
    // While editing the regeneration has the sketch, the editor draws it.
    expect([...viewport.sketchDrawings.keys()]).toEqual([EDIT_SKETCH_DRAWING_ID]);

    session.actions.run(session.sketchActionIds.finish);
    await settle();
    const drawn = viewport.sketchDrawings.get(sketchId(feature)) ?? fail();
    expect(drawn.curves).toHaveLength(4);
    expect(viewport.sketchDrawings.has(EDIT_SKETCH_DRAWING_ID)).toBe(false);

    session.featureTree.edit(feature);
    expect(session.mode.get()).toBe('sketch');
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(false);
    expect(viewport.sketchDrawings.has(EDIT_SKETCH_DRAWING_ID)).toBe(true);

    currentSketch(session).cancel();
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(true);
  });

  it('a sketch that disappears from the regeneration is no longer drawn', async () => {
    const { session, viewport } = await openSketcher();
    enterSketch(session);
    const feature = currentSketch(session).featureId;
    session.actions.run(session.sketchActionIds.finish);
    await settle();
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(true);
    session.actions.run(session.actionIds.undo);
    await settle();
    expect(viewport.sketchDrawings.has(sketchId(feature))).toBe(false);
  });

  it('a plane switched on in the browser is drawn under its id, switched off removed', async () => {
    const { session, viewport } = await openSketcher();
    const xy = ORIGIN_PLANES[0] ?? fail();
    session.browser.setPlaneVisible(ORIGIN_PLANE_IDS.xy, true);
    expect(viewport.sketchDrawings.get(ORIGIN_PLANE_IDS.xy)).toEqual(planeDrawing(xy.plane));
    session.browser.setPlaneVisible(ORIGIN_PLANE_IDS.xy, false);
    expect(viewport.sketchDrawings.has(ORIGIN_PLANE_IDS.xy)).toBe(false);
  });

  it('an axis switched on in the browser is drawn under its id, switched off removed', async () => {
    const { session, viewport } = await openSketcher();
    const z = ORIGIN_AXES.find((a) => a.id === ORIGIN_AXIS_IDS.z) ?? fail();
    session.browser.setAxisVisible(ORIGIN_AXIS_IDS.z, true);
    expect(viewport.sketchDrawings.get(ORIGIN_AXIS_IDS.z)).toEqual(axisDrawing(z));
    session.browser.setAxisVisible(ORIGIN_AXIS_IDS.z, false);
    expect(viewport.sketchDrawings.has(ORIGIN_AXIS_IDS.z)).toBe(false);
  });

  it('the drawing of a regenerated sketch carries its regions', async () => {
    const { session, viewport } = await openSketcher();
    enterSketch(session);
    const feature = currentSketch(session).featureId;
    await currentSketch(session).addGeometry(rectangleData({ width: 40, height: 20 }));
    session.actions.run(session.sketchActionIds.finish);
    await settle();
    const drawn = viewport.sketchDrawings.get(sketchId(feature)) ?? fail();
    expect(drawn.regions).toHaveLength(1);
  });

  it('the region preselected in the extrude dialog is highlighted, a pick toggles it', async () => {
    const { session, viewport } = await open({
      plugins: [boxPlugin, sketchPlugin, extrudePlugin],
    });
    enterSketch(session);
    const feature = currentSketch(session).featureId;
    await currentSketch(session).addGeometry(rectangleData({ width: 40, height: 20 }));
    session.actions.run(session.sketchActionIds.finish);
    await settle();

    // The only region of the last sketch is preselected (D6 of M19.2), so it is highlighted.
    const edit = session.features.create('extrude');
    const region = session.browser.sketches.get()[0]?.regions[0]?.region ?? fail();
    expect(edit.state.get().params['regions']).toEqual([
      { kind: 'region', sketch: feature, region },
    ]);
    expect(viewport.selection).toContainEqual({
      kind: 'sketchRegion',
      sketch: sketchId(feature),
      region,
    });
    // The dialog keeps its regions param focused: picking the region again removes it.
    session.browser.selectRegion(feature, region);
    expect(edit.state.get().params['regions']).toEqual([]);
    expect(viewport.selection).not.toContainEqual({
      kind: 'sketchRegion',
      sketch: sketchId(feature),
      region,
    });
  });

  it('a double click on a sketch in the browser opens the sketcher', async () => {
    const { session } = await openSketcher();
    enterSketch(session);
    const feature = currentSketch(session).featureId;
    session.actions.run(session.sketchActionIds.finish);
    await settle();
    session.browser.editSketch(feature);
    expect(session.mode.get()).toBe('sketch');
    expect(currentSketch(session).featureId).toBe(feature);
  });
});

describe('createAppSession – dispose', () => {
  it('releases the kernel, saves what is pending and stops the models', async () => {
    const { session, kernels, store, scheduler, viewport } = await open();
    addBox(session);
    await settle();
    const syncs = viewport.syncs.length;
    session.dispose();
    await settle();

    expect(kernels.last.disposed).toBe(true);
    expect((await store.load(DOC))?.entries).toHaveLength(1);
    expect(scheduler.pending).toBe(0);
    // Unbound from the viewport: keys reach neither the tools nor the actions.
    const run = vi.fn();
    session.actions.register({
      id: 'test.y',
      label: 'test.y',
      shortcut: 'Y',
      enabled: { get: () => true, subscribe: () => () => undefined },
      run,
    });
    viewport.emitKey(key('y'));
    expect(run).not.toHaveBeenCalled();
    expect(viewport.syncs.length).toBe(syncs);
  });

  it('close writes the pending queue to the store before it resolves, then releases', async () => {
    const memory = createMemoryDocumentStore({ now: () => 0 });
    const gated = aGatedAppendStore(memory);
    const { session, kernels, scheduler } = await open({ store: gated.store });
    addBox(session);
    await settle();

    let closed = false;
    const closing = session.close().then(() => {
      closed = true;
    });
    await settle();
    // The write is in flight: close waits for it, the session is still alive.
    expect(closed).toBe(false);
    expect(kernels.last.disposed).toBe(false);

    gated.release();
    await closing;
    expect((await memory.load(DOC))?.entries).toHaveLength(1);
    expect(kernels.last.disposed).toBe(true);
    expect(scheduler.pending).toBe(0);
  });

  it('a second close or a dispose after close does nothing', async () => {
    const memory = createMemoryDocumentStore({ now: () => 0 });
    const counting = aCountingStore(memory);
    const { session } = await open({ store: counting.store });
    addBox(session);
    await session.close();
    const appends = counting.appends();
    expect(appends).toBe(1);
    await session.close();
    session.dispose();
    await settle();
    expect(counting.appends()).toBe(appends);
  });

  it('close after dispose does nothing', async () => {
    const { session, kernels } = await open();
    session.dispose();
    await expect(session.close()).resolves.toBeUndefined();
    expect(kernels.last.disposed).toBe(true);
  });

  it('close of a read-only session releases without writing', async () => {
    const store = await aStoredDocumentWithBox();
    const counting = aCountingStore(store);
    const { session, kernels } = await open({ store: counting.store, readOnly: true });
    await session.close();
    expect(counting.appends()).toBe(0);
    expect(kernels.last.disposed).toBe(true);
  });

  it('a kernel that becomes ready after dispose is released, the viewport is not used', async () => {
    let finish: (kernel: CrashableKernel) => void = () => undefined;
    const { session, viewport } = await open({
      createKernel: () =>
        new Promise<CrashableKernel>((resolve) => {
          finish = resolve;
        }),
    });
    expect(session.kernel.get()).toBe('starting');
    session.dispose();
    const kernel = createCrashableKernel();
    finish(kernel);
    await settle();
    expect(kernel.disposed).toBe(true);
    expect(viewport.resets).toHaveLength(0);
    expect(viewport.syncs).toHaveLength(0);
  });

  it('a second dispose does nothing', async () => {
    const { session } = await open();
    session.dispose();
    expect(() => {
      session.dispose();
    }).not.toThrow();
  });
});

/** A store whose appendEntries waits until `release` is called. */
function aGatedAppendStore(inner: DocumentStore): { store: DocumentStore; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    store: {
      listDocuments: () => inner.listDocuments(),
      createDocument: (meta, initial) => inner.createDocument(meta, initial),
      deleteDocument: (id) => inner.deleteDocument(id),
      appendEntries: (id, entries) => gate.then(() => inner.appendEntries(id, entries)),
      saveSnapshot: (id, snapshot) => inner.saveSnapshot(id, snapshot),
      load: (id) => inner.load(id),
    },
    release: () => {
      release();
    },
  };
}

/** A store counting the calls of appendEntries. */
function aCountingStore(inner: DocumentStore): { store: DocumentStore; appends: () => number } {
  let appends = 0;
  return {
    store: {
      listDocuments: () => inner.listDocuments(),
      createDocument: (meta, initial) => inner.createDocument(meta, initial),
      deleteDocument: (id) => inner.deleteDocument(id),
      appendEntries: (id, entries) => {
        appends++;
        return inner.appendEntries(id, entries);
      },
      saveSnapshot: (id, snapshot) => inner.saveSnapshot(id, snapshot),
      load: (id) => inner.load(id),
    },
    appends: () => appends,
  };
}

describe('createAppSession – topological names (M14)', () => {
  /** A session with one regenerated box of height 10; `body` is its body. */
  async function openWithBox(
    plugins: readonly FeaturePlugin[],
  ): Promise<Harness & { readonly box: FeatureId; readonly body: BodyId }> {
    const harness = await open({ plugins });
    addBox(harness.session, 10);
    await settle();
    const box = harness.session.doc.studio.features[0]?.id ?? fail();
    return { ...harness, box, body: bodyId(box) };
  }

  const pointerAt = (type: ViewPointerEvent['type']): ViewPointerEvent => ({
    type,
    x: 5,
    y: 5,
    button: 'left',
    mods: { shift: false, alt: false, mod: false },
  });

  // Test value: the name the box plugin gives its top face (spec 08).
  const topOf = (box: FeatureId): TopoName => `${box}/face:top` as TopoName;

  it('the port carries the names of the bodies: the top face of the box is face 5', async () => {
    const { session, viewport, box, body } = await openWithBox([boxPlugin]);
    // The selection fills names in from the port (spec 10, "Výběr").
    session.selection.set([{ kind: 'face', body, faceIndex: 5 }]);
    expect(session.selection.items.get()).toEqual([
      { kind: 'face', body, faceIndex: 5, name: topOf(box) },
    ]);
    // So does the inspector, through the same port.
    session.topoInspector.setEnabled(true);
    viewport.setPick({ kind: 'face', body, faceIndex: 5, point: [0, 0, 10], normal: [0, 0, 1] });
    viewport.emitPointer(pointerAt('move'));
    expect(session.topoInspector.hovered.get()).toEqual({
      body,
      kind: 'face',
      index: 5,
      name: topOf(box),
    });
  });

  it('a click on an edge in the fillet dialog adds a TopoRef and highlights the edge', async () => {
    const { session, viewport, box, body } = await openWithBox([boxPlugin, filletPlugin]);
    const edit = session.features.create('fillet');
    expect(edit.state.get().activeRefParam).toBe('edges');
    viewport.setPick({ kind: 'edge', body, edgeIndex: 0, point: [0, 0, 0] });
    viewport.emitPointer(pointerAt('down'));
    viewport.emitPointer(pointerAt('up'));
    const edges = edit.state.get().params['edges'];
    // Edge 0 of the fake box lies between its bottom and front faces (spec 06, spec 08).
    const name = `edge:${box}/face:bottom|${box}/face:front`;
    expect(edges).toEqual([{ kind: 'topo', body, name }]);
    expect(viewport.selection).toContainEqual({ kind: 'edge', body, edgeIndex: 0 });
    edit.cancel();
  });

  it('a sketch on the top face of the box lies on the plane z = height', async () => {
    const { session, box, body } = await openWithBox([boxPlugin, sketchPlugin]);
    const sketch = session.sketches.create({ kind: 'topo', body, name: topOf(box) });
    expect(sketch.plane.normal).toEqual([0, 0, 1]);
    expect(sketch.plane.origin[2]).toBeCloseTo(10);
    sketch.cancel();
  });

  it('the topo inspector belongs to the session and is released with it', async () => {
    const { session, viewport, body } = await openWithBox([boxPlugin]);
    session.topoInspector.setEnabled(true);
    session.dispose();
    viewport.setPick({ kind: 'face', body, faceIndex: 5, point: [0, 0, 10], normal: [0, 0, 1] });
    viewport.emitPointer(pointerAt('move'));
    expect(session.topoInspector.hovered.get()).toBeNull();
  });
});

describe('createAppSession – export, history and colours (M15)', () => {
  const textOf = (file: DownloadFile | undefined): string => {
    const data = file?.data ?? fail();
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  };
  const enabled = (session: AppSession, id: string): boolean | undefined =>
    session.actions.actions.get().find((a) => a.id === id)?.enabled;

  it('exportStep after a regeneration downloads <document name>.step', async () => {
    const { session, downloads } = await open();
    addBox(session);
    await settle();
    expect(session.actions.run(session.fileActionIds.exportStep)).toBe(true);
    await settle();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ name: `${UNTITLED}.step`, mime: 'model/step' });
    expect(textOf(downloads[0]).startsWith('ISO-10303-21;')).toBe(true);
    expect(session.files.status.get()).toEqual({ kind: 'idle', warning: null });
  });

  it('exportStep is disabled without a body and when the only body is hidden', async () => {
    const { session } = await open();
    expect(enabled(session, session.fileActionIds.exportStep)).toBe(false);
    addBox(session);
    await settle();
    expect(enabled(session, session.fileActionIds.exportStep)).toBe(true);
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setVisible(body, false);
    expect(enabled(session, session.fileActionIds.exportStep)).toBe(false);
  });

  it('a failed kernel export → files.status failed, nothing downloaded', async () => {
    const { session, kernels, downloads } = await open();
    addBox(session);
    await settle();
    kernels.last.fake.failNext('exportStep', 'operation-failed', 'writer failed');
    session.actions.run(session.fileActionIds.exportStep);
    await settle();
    expect(session.files.status.get()).toEqual({
      kind: 'failed',
      task: 'step',
      message: 'writer failed',
    });
    expect(downloads).toEqual([]);
  });

  it('an export during a regeneration waits and exports the new state', async () => {
    const { session, kernels, viewport, downloads } = await open();
    addBox(session, 10);
    await settle();
    const before = viewport.lastSync[0]?.shape ?? fail();
    const exportStep = vi.spyOn(kernels.last.fake, 'exportStep');
    const id = session.doc.studio.features[0]?.id ?? fail();
    const edit = session.features.edit(id);
    edit.setParam('height', 20);
    edit.commit();
    // The change regenerates; the export is asked for while that runs.
    expect(session.regen.get().busy).toBe(true);
    expect(session.actions.run(session.fileActionIds.exportStep)).toBe(true);
    await settle();
    const after = viewport.lastSync[0]?.shape ?? fail();
    expect(after).not.toBe(before);
    expect(exportStep.mock.calls).toEqual([[[after]]]);
    expect(downloads).toHaveLength(1);
  });

  it('exportDocument → importDocumentFile → a new session has the same studio and undo', async () => {
    const { session, store, scheduler, downloads } = await open();
    addBox(session, 10);
    addBox(session, 20);
    await settle();
    session.actions.run(session.fileActionIds.exportDocument);
    await settle();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({
      name: `${UNTITLED}.tinycad.json`,
      mime: 'application/json',
    });
    const raw: unknown = JSON.parse(textOf(downloads[0]));
    const imported = await importDocumentFile(store, raw, {
      plugins: [boxPlugin],
      ids: createSequentialIdGenerator('imp'),
      now: () => 5,
    });
    if (!imported.ok) throw new Error('import failed');
    expect(imported.value).not.toBe(DOC);
    scheduler.advance(1000);
    session.dispose();
    await settle();

    const copy = await open({ store, docId: imported.value });
    expect(copy.session.doc.studio).toEqual(session.doc.studio);
    expect(enabled(copy.session, copy.session.actionIds.undo)).toBe(true);
    copy.session.actions.run(copy.session.actionIds.undo);
    expect(copy.session.doc.studio.features).toHaveLength(1);
  });

  it('history shows a created feature and its undo, newest first', async () => {
    const { session } = await open();
    expect(session.history.state.get()).toEqual({ rows: [], total: 0, older: 0 });
    addBox(session);
    session.actions.run(session.actionIds.undo);
    const { rows, total } = session.history.state.get();
    expect(total).toBe(2);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['undo', null],
      ['do', 'undone'],
    ]);
  });

  it('a colour set in the browser goes to the viewport, again after a sync, null resets it', async () => {
    const { session, viewport } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setColor(body, '#ff0000');
    expect(viewport.colorCalls).toEqual([{ body, color: '#ff0000' }]);
    viewport.colorCalls.length = 0;
    addBox(session);
    await settle();
    expect(viewport.colorCalls).toContainEqual({ body, color: '#ff0000' });
    session.browser.setColor(body, null);
    expect(viewport.colorCalls[viewport.colorCalls.length - 1]).toEqual({ body, color: null });
  });

  it('a stored colour is shown after a reopen', async () => {
    const { session, store } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.browser.setColor(body, '#00ff00');
    await session.close();

    const reopened = await open({ store });
    expect(reopened.viewport.colorCalls).toContainEqual({ body, color: '#00ff00' });
  });

  it('defaultBodyColor is the face colour of the palette of the theme', async () => {
    const { session } = await open();
    expect(session.defaultBodyColor.get()).toBe('#b9c3d1');
    session.setTheme('dark');
    expect(session.defaultBodyColor.get()).toBe('#3b6aa6');
    session.setTheme('light');
    expect(session.defaultBodyColor.get()).toBe('#b9c3d1');
  });

  it('defaultBodyColor starts with the face colour of the theme at the start', async () => {
    const { session } = await open({ theme: 'dark' });
    expect(session.defaultBodyColor.get()).toBe('#3b6aa6');
  });
});

describe('createAppSession – a store that fails for good (M19.1, D4)', () => {
  it('persistence failed with its error; the export downloads the live document without history', async () => {
    const { session, store, scheduler, downloads } = await open();
    expect(session.persistenceError.get()).toBeNull();
    // The document disappears from the store (e.g. site data cleared): every write is refused.
    await store.deleteDocument(DOC);
    addBox(session, 10);
    scheduler.advance(1000);
    await settle();
    expect(session.persistence.get()).toBe('failed');
    expect(session.persistenceError.get()).toBe(`Document '${DOC}' does not exist`);

    addBox(session, 20);
    session.actions.run(session.fileActionIds.exportDocument);
    await settle();
    // The File actions warn that the file lacks the history (M19.1).
    expect(session.files.status.get()).toEqual({
      kind: 'idle',
      warning: 'file.exportedWithoutHistory',
    });
    expect(downloads).toHaveLength(1);
    const data = downloads[0]?.data ?? fail();
    const raw: unknown = JSON.parse(
      typeof data === 'string' ? data : new TextDecoder().decode(data),
    );
    expect(raw).not.toHaveProperty('history');
    expect(raw).toMatchObject({
      snapshot: { atSeq: 0, document: { studio: { features: [{}, {}] } } },
    });
  });

  it('persistenceError is null in a read-only session', async () => {
    const store = await aStoredDocumentWithBox();
    const { session } = await open({ store, readOnly: true });
    expect(session.persistenceError.get()).toBeNull();
  });
});

describe('createAppSession – manipulators (M18)', () => {
  const NO_MODS = { shift: false, alt: false, mod: false };
  const pointer = (type: ViewPointerEvent['type'], x: number, y: number): ViewPointerEvent => ({
    type,
    x,
    y,
    button: 'left',
    mods: NO_MODS,
  });

  /** A box and an open Transform dialog moving it, regenerated. */
  async function openTransform(): Promise<Harness & { readonly transform: FeatureId }> {
    const harness = await open({ plugins: [boxPlugin, transformPlugin] });
    addBox(harness.session);
    await settle();
    const body = harness.session.browser.bodies.get()[0]?.body ?? fail();
    const edit = harness.session.features.create('transform');
    edit.setParam('bodies', [{ kind: 'body', body }]);
    await settle();
    return { ...harness, transform: edit.featureId };
  }

  it('shows the handles of the Transform in its default mode Free in the open dialog', async () => {
    const { viewport } = await openTransform();
    expect(viewport.manipulatorViews.map((v) => v.id)).toEqual([
      'tx',
      'ty',
      'tz',
      'txy',
      'tyz',
      'tzx',
      'tc',
      'rx',
      'ry',
      'rz',
    ]);
  });

  it('dragging tz changes translate, OK writes one entry', async () => {
    const { session, viewport, store, scheduler, transform } = await openTransform();
    scheduler.advance(1000);
    await settle();
    const before = (await store.load(DOC))?.entries.length ?? fail();
    viewport.prepareHandlePick((x, y) => (x === 0 && y === 0 ? 'tz' : null));
    // A horizontal ray at height y: its closest point on the vertical arrow is at z = y.
    viewport.setScreenToRay((_x, y) => ({ origin: [1000, 0, y], direction: [-1, 0, 0] }));

    viewport.emitPointer(pointer('down', 0, 0));
    viewport.emitPointer(pointer('move', 0, 7));
    viewport.emitPointer(pointer('up', 0, 7));
    expect(session.doc.feature(transform)?.params).toMatchObject({ translate: [0, 0, 7] });

    session.features.current.get()?.commit();
    scheduler.advance(1000);
    await settle();
    expect((await store.load(DOC))?.entries).toHaveLength(before + 1);
    expect(viewport.manipulatorViews).toEqual([]);
  });

  it('dispose clears the handles in the view', async () => {
    const { session, viewport } = await openTransform();
    expect(viewport.manipulatorViews).toHaveLength(10);
    session.dispose();
    expect(viewport.manipulatorViews).toEqual([]);
  });

  it('the HUD of an open Transform has its 4 modes, the first active (M19)', async () => {
    const { session } = await openTransform();
    const hud = session.manipulator.hud.get() ?? fail();
    expect(hud.modes.map((m) => [m.id, m.active])).toEqual([
      ['free', true],
      ['move', false],
      ['rotate', false],
      ['pivot', false],
    ]);
  });

  it('setMode rotate shows the three full circles (M19)', async () => {
    const { session, viewport } = await openTransform();
    session.manipulator.setMode('rotate');
    expect(viewport.manipulatorViews.map((v) => [v.id, v.kind])).toEqual([
      ['rx', 'angular'],
      ['ry', 'angular'],
      ['rz', 'angular'],
    ]);
    expect(session.manipulator.hud.get()?.modes.find((m) => m.active)?.id).toBe('rotate');
  });

  it('setValue writes translate of the Transform (M19)', async () => {
    const { session, transform } = await openTransform();
    session.manipulator.setValue('tz', 12);
    expect(session.doc.feature(transform)?.params).toMatchObject({ translate: [0, 0, 12] });
  });

  it('project and onViewChanged are forwarded from the viewport (M19)', async () => {
    const { session, viewport } = await open();
    expect(session.manipulator.project([1, 2, 3])).toBeNull();
    viewport.prepareProject(([x, y]) => [x * 10, y * 10]);
    expect(session.manipulator.project([1, 2, 3])).toEqual([10, 20]);

    let calls = 0;
    const off = session.manipulator.onViewChanged(() => {
      calls++;
    });
    viewport.emitViewChanged({ generation: 1 });
    off();
    viewport.emitViewChanged({ generation: 2 });
    expect(calls).toBe(1);
  });
});

describe('createAppSession: view and grid (M19.2)', () => {
  it('view.project and view.onViewChanged are forwarded from the viewport', async () => {
    const { session, viewport } = await open();
    expect(session.view.project([1, 2, 3])).toBeNull();
    viewport.prepareProject(([x, y]) => [x * 10, y * 10]);
    expect(session.view.project([1, 2, 3])).toEqual([10, 20]);

    let calls = 0;
    const off = session.view.onViewChanged(() => {
      calls++;
    });
    viewport.emitViewChanged({ generation: 1 });
    off();
    viewport.emitViewChanged({ generation: 2 });
    expect(calls).toBe(1);
  });

  it('the sketch tools snap to the grid step drawn by the viewport', async () => {
    const { session, viewport } = await open({ plugins: [boxPlugin, sketchPlugin] });
    // Only the tools read the step; the facade does not offer it (Ú13a).
    expectTypeOf(session.sketches).not.toHaveProperty('gridStep');
    viewport.prepareSketchGridStep(5);
    expect(session.actions.run(session.toolActionId('sketch'))).toBe(true);
    session.tools.activate('sketch.line');
    const click = (x: number, y: number): void => {
      for (const type of ['move', 'down', 'up'] as const)
        viewport.emitPointer({
          type,
          x,
          y,
          button: type === 'move' ? null : 'left',
          mods: { shift: false, alt: false, mod: false },
        });
    };
    click(7, 3);
    await settle();
    click(13, 9);
    await settle();
    const points = (session.sketches.current.get()?.state.get().entities ?? []).flatMap((e) =>
      e.kind === 'point' ? [[e.x, e.y]] : [],
    );
    expect(points).toEqual([
      [5, 5],
      [15, 10],
    ]);
  });
});

function fail(): never {
  throw new Error('Missing test data');
}
