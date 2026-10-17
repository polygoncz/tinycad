import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId, FeatureId } from '@/document';
import {
  aBodyView,
  aCoreError,
  aFeatureTypeDescriptor,
  aReadModel,
  createFakeCore,
  createManualTimers,
} from '@/remote/testing';
import type { FakeCore } from '@/remote/testing';
import { createFakeSolver, createFakeTextOutliner } from '@/sketch/testing';
import type { SketchGeometry } from '@/sketch';
import type { AppSession } from '@/app/index';
import { createRemoteAppSession } from '@/app/remote-session';
import { FakeAppViewport } from '@/app/testing';

// Values of ErrorReason of errors.proto: tests of app may not import protocol, so the fake core
// gets the numbers (in the domain of the enum, so they type-check).
const REASON = {
  UNSPECIFIED: 0,
  INVALID_OPERATION: 1,
  READ_ONLY: 3,
  NO_TRANSACTION: 5,
  SKETCH_NOT_SOLVED: 9,
  SESSION_NOT_FOUND: 10,
  STORAGE: 16,
} as const;
type ReadModel = ReturnType<typeof aReadModel>;

const DOC = 'doc-1' as DocumentId; // an id of the catalog of the fake core
const F1 = 'f1' as FeatureId; // test ids are trusted

/** Lets the router transport, the session and the view run (no time passes). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** A read model of a document with one feature 'thing' f1 of `size`, its bodies in `bodies`. */
function model(
  size: number,
  generation: number,
  extra: {
    readonly writable?: boolean;
    readonly bodies?: ReturnType<typeof aBodyView>[];
    /** The label of a transaction open on the document. */
    readonly transaction?: string;
  } = {},
): ReadModel {
  return aReadModel({
    document: {
      documentId: DOC,
      features: [
        {
          id: F1,
          type: 'thing',
          typeVersion: 1,
          name: 'Thing 1',
          suppressed: false,
          params: { size },
        },
      ],
      rollbackIndex: 1,
    },
    regen: { generation: BigInt(generation), final: { bodies: extra.bodies ?? [] } },
    session: {
      writable: extra.writable ?? true,
      ...(extra.transaction === undefined ? {} : { transaction: { label: extra.transaction } }),
    },
  });
}

/** Never called: no test here uses the sketch geometry. */
const NO_GEOMETRY: SketchGeometry = new Proxy({} as SketchGeometry, {
  get: () => () => Promise.reject(new Error('no sketch geometry in this test')),
});

const opened: AppSession[] = [];
// M48: nothing of a known kind goes to the console any more (N153); the notices show it.
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  for (const session of opened.splice(0)) session.dispose();
  consoleError.mockRestore();
});

function noticeKeys(session: AppSession): readonly string[] {
  return session.notices.get().map((n) => n.key);
}

interface SetupOptions {
  readonly writable?: boolean;
  readonly bodies?: ReturnType<typeof aBodyView>[];
  /** The read model of the first OpenSession, instead of the state of the server. */
  readonly opened?: ReadModel;
}

async function setup({ writable = true, bodies, opened: first }: SetupOptions = {}) {
  const core = createFakeCore();
  if (first !== undefined) {
    core.respond('openSession', {
      sessionId: 'session-1',
      readModel: first,
      eventSeq: 0n,
      featureTypes: [aFeatureTypeDescriptor()],
    });
  }
  // The state of the server: every answer carries it, a test changes it.
  let server = model(10, 1, { writable, ...(bodies === undefined ? {} : { bodies }) });
  const answer = () => ({ result: { readModel: server } });
  core.fallback('openSession', () => ({
    sessionId: 'session-1',
    readModel: server,
    eventSeq: 0n,
    featureTypes: [aFeatureTypeDescriptor()],
  }));
  core.fallback('getReadModel', () => ({ readModel: server }));
  for (const method of [
    'dispatch',
    'beginTransaction',
    'apply',
    'applyTransient',
    'commit',
    'abort',
    'undo',
    'redo',
  ] as const) {
    core.fallback(method, answer);
  }
  const viewport = new FakeAppViewport();
  let next = 0;
  const session = await createRemoteAppSession({
    plugins: [],
    transport: core.transport,
    docId: DOC,
    viewport,
    timers: createManualTimers(),
    resume: { load: () => null, save: () => undefined },
    newOperationId: () => `op-${String(++next)}`,
    ids: createSequentialIdGenerator('n'),
    translate: (key) => key,
    confirm: () => true,
    solver: createFakeSolver(),
    text: createFakeTextOutliner(),
    geometry: NO_GEOMETRY,
    download: () => undefined,
    theme: 'light',
    retry: { attempts: 1, baseDelayMs: 0 },
  });
  opened.push(session);
  await flush();
  return {
    core,
    session,
    viewport,
    setServer: (next: ReadModel) => {
      server = next;
    },
  };
}

function sizeOf(session: AppSession): unknown {
  const params: unknown = session.doc.feature(F1)?.params;
  return typeof params === 'object' && params !== null && 'size' in params
    ? params.size
    : undefined;
}

/** A held answer of the fake core: released by the test. */
function held<T>(): { readonly promise: Promise<T>; release(value: T): void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: (value) => {
      release(value);
    },
  };
}

function lastInputOf(core: FakeCore): string | undefined {
  return core.requests('getReadModel').at(-1)?.read?.inputOf;
}

describe('createRemoteAppSession', () => {
  it('opens the document of the read model, writable and online', async () => {
    const { session } = await setup();
    expect(sizeOf(session)).toBe(10);
    expect(session.readOnly).toBe(false);
    expect(session.kernel.get()).toBe('ready');
    expect(session.persistence.get()).toBe('saved');
  });

  it('a change from the dialog: the dialog shows the entered value, the document the answer (N164)', async () => {
    const { core, session } = await setup();
    core.respond('apply', { result: { readModel: model(21, 2) } });
    const edit = session.features.edit(F1);
    const shown: unknown[] = [];
    edit.state.subscribe(() => shown.push(edit.state.get().params['size']));
    edit.setParam('size', 20);
    expect(edit.state.get().params['size']).toBe(20);
    expect(sizeOf(session)).toBe(10);
    await flush();
    expect(sizeOf(session)).toBe(21);
    // N165: the promise of the change resolves after the document shows the answer, so the dialog
    // never falls back to the document of before (10).
    expect(shown).toEqual([20, 21]);
  });

  it('the dialog creates a feature: it is in the document only with the answer', async () => {
    const { core, session } = await setup();
    const answer = held<{ result: { readModel: ReadModel } }>();
    core.respond('apply', () => answer.promise);
    const edit = session.features.create('thing');
    await flush();
    const added = core.requests('apply')[0]?.op?.op;
    expect(added?.case).toBe('featureAdd');
    expect(session.doc.feature(edit.featureId)).toBeUndefined();
    expect(edit.state.get().params).toEqual({ size: 10 });
    const withNew = aReadModel({
      document: {
        documentId: DOC,
        features: [
          ...(model(10, 2).document?.features ?? []),
          {
            id: edit.featureId,
            type: 'thing',
            typeVersion: 1,
            name: 'Thing 2',
            suppressed: false,
            params: { size: 10 },
          },
        ],
        rollbackIndex: 2,
      },
      regen: { generation: 2n },
    });
    answer.release({ result: { readModel: withNew } });
    await flush();
    expect(session.doc.feature(edit.featureId)?.name).toBe('Thing 2');
  });

  // The review after M46/M47: one ordering rule for read models (N136), in the session.
  it('a refresh of G2 answered before the change of G1: the document and the view stay on G2', async () => {
    const { core, session } = await setup();
    const answer = held<{ result: { readModel: ReadModel } }>();
    core.respond('dispatch', () => answer.promise);
    // G2: the rename and a change of another tab (size 50, a body).
    const g2 = model(50, 2, { bodies: [aBodyView()] });
    core.respond('getReadModel', { readModel: g2 });
    expect(session.documentName.rename('Other')).toBe(true);
    await flush();
    session.retryKernel(); // GetReadModel
    await flush();
    answer.release({ result: { readModel: model(10, 1) } });
    await flush();
    expect(sizeOf(session)).toBe(50);
    expect(session.regen.get().bodyCount).toBe(1);
  });

  it('a read-only tab keeps persistence saved', async () => {
    const { session } = await setup({ writable: false });
    session.retryKernel();
    await flush();
    expect(session.persistence.get()).toBe('saved');
  });

  it('is read-only when the session is not writable and sends no change', async () => {
    const { core, session } = await setup({ writable: false });
    expect(session.readOnly).toBe(true);
    expect(session.locked.get()).toBe(true);
    expect(() => session.features.edit(F1)).toThrow(/read-only/);
    expect(session.documentName.rename('Other')).toBe(false);
    await flush();
    expect(core.calls).not.toContain('beginTransaction');
    expect(core.calls).not.toContain('dispatch');
  });

  // E2E M46: a reload whose CloseSession got lost resumes the session with the transaction of
  // the dialog of the page before; this page has no dialog, so every begin failed.
  it('aborts the transaction a resumed session still has open, before anything else', async () => {
    const resumed = model(99, 1, { transaction: 'feature.edit' });
    const { core, session } = await setup({ opened: resumed });
    expect(core.calls.filter((c) => c !== 'watchSession').slice(0, 2)).toEqual([
      'openSession',
      'abort',
    ]);
    expect(sizeOf(session)).toBe(10);
    session.features.edit(F1).setParam('size', 12);
    await flush();
    expect(core.calls).toContain('beginTransaction');
  });

  it('a transaction lost on the server closes the dialog', async () => {
    const { core, session } = await setup();
    const edit = session.features.edit(F1);
    await flush();
    core.respond('apply', aCoreError(Code.NotFound, REASON.SESSION_NOT_FOUND));
    edit.setParam('size', 30);
    await flush();
    expect(session.features.current.get()).toBeNull();
    expect(sizeOf(session)).toBe(10);
    expect(core.requests('openSession')).toHaveLength(2);
    expect(noticeKeys(session)).toEqual(['notice.transactionLost']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('SKETCH_NOT_SOLVED of a setParams: the notice sketch.notSolved, the entered value stays (N65, N164)', async () => {
    const { core, session } = await setup();
    const edit = session.features.edit(F1);
    await flush();
    core.respond('apply', aCoreError(Code.FailedPrecondition, REASON.SKETCH_NOT_SOLVED));
    edit.setParam('size', 30);
    await flush();
    expect(edit.state.get().params['size']).toBe(30);
    expect(sizeOf(session)).toBe(10);
    expect(noticeKeys(session)).toEqual(['sketch.notSolved']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('STORAGE of a Commit: the notice and an Abort; the next change goes through (N167)', async () => {
    const { core, session } = await setup();
    const edit = session.features.edit(F1);
    await flush();
    core.respond('commit', aCoreError(Code.Internal, REASON.STORAGE));
    core.respond('abort', aCoreError(Code.FailedPrecondition, REASON.NO_TRANSACTION));
    edit.commit();
    expect(session.features.current.get()).toBeNull();
    await flush();
    expect(core.calls).toContain('abort');
    expect(session.notices.get().map((n) => [n.key, n.params])).toEqual([
      ['notice.changeRejected', { reason: 'STORAGE' }],
    ]);
    expect(session.documentName.rename('Bracket')).toBe(true);
    await flush();
    expect(core.requests('dispatch')).toHaveLength(1);
    expect(session.notices.get()).toHaveLength(1);
  });

  it('READ_ONLY: the notice notice.readOnly (N146, N153)', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', aCoreError(Code.FailedPrecondition, REASON.READ_ONLY));
    session.documentName.rename('Bracket');
    await flush();
    expect(session.doc.meta.name).toBe('Document');
    expect(noticeKeys(session)).toEqual(['notice.readOnly']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('another refusal: notice.changeRejected with the reason', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', aCoreError(Code.InvalidArgument, REASON.INVALID_OPERATION));
    session.documentName.rename('Bracket');
    await flush();
    expect(session.notices.get().map((n) => [n.key, n.params])).toEqual([
      ['notice.changeRejected', { reason: 'INVALID_OPERATION' }],
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('dismissNotice removes the notice', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', aCoreError(Code.FailedPrecondition, REASON.READ_ONLY));
    session.documentName.rename('Bracket');
    await flush();
    const [notice] = session.notices.get();
    if (notice === undefined) throw new Error('expected a notice');
    session.dismissNotice(notice.id);
    expect(session.notices.get()).toEqual([]);
  });

  it('opening and closing a dialog reads the model again with and without input_of', async () => {
    const { core, session } = await setup();
    const edit = session.features.edit(F1);
    await flush();
    expect(lastInputOf(core)).toBe(F1);
    edit.cancel();
    await flush();
    expect(lastInputOf(core)).toBe('');
  });

  it('flush waits for the empty queue', async () => {
    const { core, session, setServer } = await setup();
    const answer = held<{ result: { readModel: ReadModel } }>();
    core.respond('dispatch', () => answer.promise);
    expect(session.documentName.rename('Bracket')).toBe(true);
    let flushed = false;
    void session.flush().then(() => {
      flushed = true;
    });
    await flush();
    expect(flushed).toBe(false);
    expect(session.persistence.get()).toBe('pending');
    setServer(model(10, 2));
    answer.release({ result: { readModel: model(10, 2) } });
    await flush();
    expect(flushed).toBe(true);
    expect(session.persistence.get()).toBe('saved');
  });

  it('a change given up offline makes saving failed and flush rejects (N92)', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', aCoreError(Code.Unavailable, REASON.UNSPECIFIED));
    session.documentName.rename('Bracket');
    await flush();
    expect(session.kernel.get()).toBe('unavailable');
    expect(session.persistence.get()).toBe('failed');
    expect(session.doc.meta.name).toBe('Document');
    await expect(session.flush()).rejects.toThrow(/not saved/);
    // The title bar and serverUnavailable show it; the dropped change itself is no notice.
    expect(noticeKeys(session)).toEqual(['notice.serverUnavailable']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps the mesh a request in flight says it has (N93)', async () => {
    const v1 = aBodyView({ contentVersion: 'v1' });
    const { core, session, viewport } = await setup({ bodies: [v1] });
    const answer = held<{ result: { readModel: ReadModel } }>();
    core.respond('dispatch', () => answer.promise);
    session.documentName.rename('Bracket');
    await flush();
    expect(core.requests('dispatch')[0]?.read?.knownMeshes).toEqual(['v1']);
    // Meanwhile a read model without v1 is shown and retains its own versions.
    core.respond('getReadModel', {
      readModel: model(10, 2, { bodies: [aBodyView({ contentVersion: 'v2' })] }),
    });
    session.retryKernel();
    await flush();
    // The answer brings v1 back without its mesh: the client said it has it.
    answer.release({
      result: {
        readModel: model(10, 3, { bodies: [aBodyView({ contentVersion: 'v1', mesh: undefined })] }),
      },
    });
    await flush();
    const shape = viewport.syncs.at(-1)?.[0]?.shape;
    if (shape === undefined) throw new Error('expected a synced body');
    const meshes = viewport.resets[0];
    if (meshes === undefined) throw new Error('expected the meshes of the view');
    await expect(
      meshes.tessellate(shape, { linearDeflection: 0.1, angularDeflection: 0.5 }),
    ).resolves.toBeDefined();
  });

  it('close flushes, then closes the session on the core', async () => {
    const { core, session } = await setup();
    await session.close();
    expect(core.calls).toContain('closeSession');
  });
});
