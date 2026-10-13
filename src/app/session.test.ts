import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createDocument } from '@/document';
import type { DocumentId } from '@/document';
import { boxPlugin } from '@/features/box';
import type { ViewKeyEvent } from '@/interaction';
import { createMemoryDocumentStore, createSnapshot } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import type { ManualScheduler } from '@/persistence/testing';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import { createAppSession } from './index';
import { RESTART_WINDOW_MS } from './kernel-supervisor';
import type { AppSession, AppSessionDeps, KernelUiState } from './index';
import { aKernelFactory, createCrashableKernel, FakeAppViewport, settle } from './testing';
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
  /** Moves the clock of `now`. */
  readonly advance: (ms: number) => void;
}

async function open(
  overrides: Partial<AppSessionDeps> & { kernels?: KernelFactory } = {},
): Promise<Harness> {
  const store = overrides.store ?? createMemoryDocumentStore({ now: () => 0 });
  const kernels = overrides.kernels ?? aKernelFactory();
  const viewport = new FakeAppViewport();
  const scheduler = createManualScheduler();
  let time = 1_000_000;
  const session = await createAppSession({
    plugins: [boxPlugin],
    store,
    docId: DOC,
    createKernel: kernels.create,
    viewport,
    scheduler,
    now: () => time,
    ids: createSequentialIdGenerator('f'),
    translate,
    readOnly: false,
    ...overrides,
  });
  await settle();
  return {
    session,
    store,
    kernels,
    viewport,
    scheduler,
    advance: (ms) => {
      time += ms;
    },
  };
}

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
    expect(session.regen.get()).toMatchObject({ busy: false, bodyCount: 0, errorCount: 0 });
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
    expect(session.toolList.map((t) => t.id)).toEqual(['select', 'box']);
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
    expect(regen).toMatchObject({ busy: false, bodyCount: 1, errorCount: 0 });
    expect(regen.lastMs).not.toBeNull();
    expect(session.browser.bodies.get()).toHaveLength(1);
    expect(session.featureTree.rows.get()[0]?.status).toBe('ok');
  });

  it('ten quick changes regenerate at most twice', async () => {
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

    expect(viewport.syncs.length - syncsBefore).toBeLessThanOrEqual(2);
    expect(kernels.last.fake.callCount('makeBox') - boxesBefore).toBeLessThanOrEqual(2);
    expect(session.regen.get().busy).toBe(false);
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
    expect(session.regen.get()).toMatchObject({ bodyCount: 1, errorCount: 1 });
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

  it('two crashes within the window → failed', async () => {
    const { session, kernels, advance } = await open();
    addBox(session);
    await settle();
    kernels.last.crash();
    addBox(session);
    await settle();
    advance(RESTART_WINDOW_MS - 1);
    kernels.last.crash();
    addBox(session);
    await settle();
    expect(session.kernel.get()).toBe('failed');
    expect(kernels.kernels).toHaveLength(2);
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
    expect(() => {
      session.featureTree.rename(id, 'Other');
    }).toThrow(/read-only/);

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

  it('fit all fits the camera of the viewport', async () => {
    const { session, viewport } = await open();
    const before = viewport.fitAllCount;
    session.actions.run(session.actionIds.fitAll);
    expect(viewport.fitAllCount).toBe(before + 1);
  });
});

describe('createAppSession – first view', () => {
  it('the first regeneration with a body fits the camera once', async () => {
    const { session, viewport } = await open();
    expect(viewport.fitAllCount).toBe(0);
    addBox(session);
    await settle();
    expect(viewport.fitAllCount).toBe(1);
    addBox(session);
    await settle();
    expect(viewport.fitAllCount).toBe(1);
  });

  it('a stored document with bodies is fitted once after opening', async () => {
    const store = await aStoredDocumentWithBox();
    const { viewport } = await open({ store });
    expect(viewport.fitAllCount).toBe(1);
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

function fail(): never {
  throw new Error('Missing test data');
}
