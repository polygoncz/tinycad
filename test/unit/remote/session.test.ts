import { Code } from '@connectrpc/connect';
import type { Transport } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import type { DocumentId, FeatureId } from '@/document';
import { OP_VERSION } from '@/ops';
import type { FeatureRenameOp, FeatureSetParamsOp } from '@/ops';
import { ErrorReason } from '@/protocol';
import { openRemoteSession, RemoteError } from '@/remote';
import type { ConnectionState, ReadOptions, RemoteSessionOptions } from '@/remote';
import {
  aCoreError,
  aFeatureTypeDescriptor,
  aReadModel,
  createFakeCore,
  createManualTimers,
} from '@/remote/testing';
import type { FakeCore } from '@/remote/testing';
import { KEEPALIVE_HEADER } from '@/remote/transport';

/** Lets the router transport and the loops of the session run (no time passes). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** The core's transport, recording the keepalive header of every unary call. */
function recording(inner: Transport) {
  const keepalive: (readonly [string, string | null])[] = [];
  const transport: Transport = {
    unary: (method, signal, timeoutMs, header, input, contextValues) => {
      keepalive.push([method.localName, new Headers(header).get(KEEPALIVE_HEADER)]);
      return inner.unary(method, signal, timeoutMs, header, input, contextValues);
    },
    stream: (method, signal, timeoutMs, header, input, contextValues) =>
      inner.stream(method, signal, timeoutMs, header, input, contextValues),
  };
  return { transport, keepalive };
}

interface SetupOptions {
  readonly resume?: string | null;
  readonly before?: (core: FakeCore) => void;
}

async function setup({ resume = null, before }: SetupOptions = {}) {
  const core = createFakeCore();
  before?.(core);
  const timers = createManualTimers();
  const { transport, keepalive } = recording(core.transport);
  const saved: (string | null)[] = [];
  let read: ReadOptions = { knownMeshes: [], inputOf: null };
  let next = 0;
  const options: RemoteSessionOptions = {
    transport,
    docId: 'doc-1' as DocumentId, // an id of the catalog of the fake core
    newOperationId: () => `op-${String(++next)}`,
    readOptions: () => read,
    resume: { load: () => resume, save: (id) => saved.push(id) },
    timers,
  };
  const session = await openRemoteSession(options);
  const connection: ConnectionState[] = [];
  session.connection.subscribe(() => connection.push(session.connection.get()));
  const lost: string[] = [];
  session.events.on('lost', (e) => lost.push(e.what));
  await flush();
  return {
    core,
    timers,
    session,
    saved,
    connection,
    lost,
    keepalive,
    setRead: (r: ReadOptions) => {
      read = r;
    },
  };
}

const rename = (name: string): FeatureRenameOp => ({
  type: 'feature.rename',
  v: OP_VERSION['feature.rename'],
  featureId: 'f1' as FeatureId, // a test id
  name,
});

const setParams = (featureId: string, size: number): FeatureSetParamsOp => ({
  type: 'feature.setParams',
  v: OP_VERSION['feature.setParams'],
  featureId: featureId as FeatureId, // a test id
  typeVersion: 1,
  params: { size },
});

const unavailable = () => aCoreError(Code.Unavailable, ErrorReason.UNSPECIFIED);
const sessionNotFound = () => aCoreError(Code.NotFound, ErrorReason.SESSION_NOT_FOUND);

/** An answer the test releases later, to hold a change in flight. */
function held() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = async () => {
    await gate;
    return { result: { readModel: aReadModel() } };
  };
  return { answer, release };
}

describe('openRemoteSession', () => {
  it('opens a session, keeps its id and watches it from event_seq', async () => {
    const { core, session, saved } = await setup({
      before: (c) => {
        c.respond('openSession', {
          sessionId: 'session-7',
          featureTypes: [aFeatureTypeDescriptor()],
          readModel: aReadModel({ document: { name: 'Bracket' } }),
          eventSeq: 4n,
        });
      },
    });
    expect(core.requests('openSession')).toMatchObject([
      { documentId: 'doc-1', resumeSessionId: '' },
    ]);
    expect(saved).toEqual(['session-7']);
    expect(session.featureTypes.map((t) => t.type)).toEqual(['thing']);
    expect(session.readModel.get().document.name).toBe('Bracket');
    expect(session.connection.get()).toBe('online');
    expect(core.requests('watchSession')).toMatchObject([{ sessionId: 'session-7', afterSeq: 4n }]);
    session.dispose();
  });

  it('resumes the session of the tab before a reload', async () => {
    const { core, session, saved } = await setup({
      resume: 'session-old',
      before: (c) => {
        c.respond('openSession', { sessionId: 'session-old', readModel: aReadModel() });
      },
    });
    expect(core.requests('openSession')[0]?.resumeSessionId).toBe('session-old');
    expect(saved).toEqual(['session-old']);
    session.dispose();
  });

  it('rejects with RemoteError when the core does not open it', async () => {
    const promise = setup({
      before: (c) => {
        c.respond('openSession', aCoreError(Code.NotFound, ErrorReason.DOCUMENT_NOT_FOUND));
      },
    });
    await expect(promise).rejects.toMatchObject({ reason: 'DOCUMENT_NOT_FOUND' });
    await expect(promise).rejects.toBeInstanceOf(RemoteError);
  });
});

describe('RemoteSession.change', () => {
  it('sends one change at a time, in order', async () => {
    const { core, session } = await setup();
    const first = held();
    core.respond('dispatch', first.answer);
    const a = session.change({ kind: 'dispatch', op: rename('a'), label: 'Rename' });
    const b = session.change({ kind: 'undo' });
    await flush();
    expect(core.calls.filter((m) => m !== 'watchSession')).toEqual(['openSession', 'dispatch']);
    expect(session.pending.get()).toBe(2);
    first.release();
    await Promise.all([a, b]);
    expect(core.calls.filter((m) => m !== 'watchSession')).toEqual([
      'openSession',
      'dispatch',
      'undo',
    ]);
    expect(core.requests('dispatch')).toMatchObject([
      { sessionId: 'session-1', operationId: 'op-1', label: 'Rename' },
    ]);
    expect(core.requests('undo')).toMatchObject([{ operationId: 'op-2' }]);
    expect(session.pending.get()).toBe(0);
    session.dispose();
  });

  it('resolves with the entry and the read model, which the session publishes', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', {
      result: {
        entry: { seq: 3n, kind: 1, label: 'Rename', opType: 'feature.rename' },
        readModel: aReadModel({ regen: { generation: 5n } }),
      },
    });
    const outcome = await session.change({ kind: 'dispatch', op: rename('a') });
    expect(outcome).toMatchObject({ ok: true, entry: { seq: 3, kind: 'do', label: 'Rename' } });
    expect(session.readModel.get().regen.generation).toBe(5);
    if (outcome.ok) expect(session.readModel.get()).toBe(outcome.readModel);
    session.dispose();
  });

  it('a failure of the server is the outcome, not a rejection', async () => {
    const { core, session } = await setup();
    core.respond('undo', aCoreError(Code.FailedPrecondition, ErrorReason.NOTHING_TO_UNDO));
    const outcome = await session.change({ kind: 'undo' });
    expect(outcome).toMatchObject({ ok: false, error: { reason: 'NOTHING_TO_UNDO' } });
    expect(session.connection.get()).toBe('online');
    session.dispose();
  });

  it('reads the read options when the request is sent, not when it is queued', async () => {
    const { core, session, setRead } = await setup();
    const first = held();
    core.respond('beginTransaction', first.answer);
    void session.change({ kind: 'begin', label: 'Edit' });
    const applied = session.change({ kind: 'apply', op: rename('a') });
    await flush();
    setRead({ knownMeshes: ['v1'], inputOf: 'f1' as FeatureId }); // a test id
    first.release();
    await applied;
    expect(core.requests('beginTransaction')[0]?.read).toMatchObject({ knownMeshes: [] });
    expect(core.requests('apply')[0]?.read).toMatchObject({ knownMeshes: ['v1'], inputOf: 'f1' });
    session.dispose();
  });

  // E2E M46: the feature dialog begins its transaction before it is the open dialog, so a begin
  // sent at once went without input_of, and its answer replaced the input of the refresh.
  it('a change goes after the synchronous code that queued it: it reads the options set there', async () => {
    const { core, session, setRead } = await setup();
    const begun = session.change({ kind: 'begin', label: 'Edit' });
    setRead({ knownMeshes: [], inputOf: 'f1' as FeatureId }); // a test id
    await begun;
    expect(core.requests('beginTransaction')[0]?.read?.inputOf).toBe('f1');
    session.dispose();
  });

  it('a queued apply of setParams is replaced by a newer one of the same feature', async () => {
    const { core, session } = await setup();
    const first = held();
    core.respond('beginTransaction', first.answer);
    void session.change({ kind: 'begin', label: 'Drag' });
    const a = session.change({ kind: 'apply', op: setParams('f1', 1) });
    const b = session.change({ kind: 'apply', op: setParams('f1', 2) });
    const other = session.change({ kind: 'apply', op: setParams('f2', 3) });
    first.release();
    const outcomes = await Promise.all([a, b, other]);
    expect(core.requests('apply').map((r) => r.operationId)).toEqual(['op-3', 'op-4']);
    expect(outcomes[0]).toBe(outcomes[1]);
    session.dispose();
  });

  it('repeats a retryable failure with the same operation_id, waiting 200 ms × 2ⁿ', async () => {
    const { core, timers, session, connection } = await setup();
    core.respond('dispatch', unavailable(), unavailable());
    const outcome = session.change({ kind: 'dispatch', op: rename('a') });
    await flush();
    expect(timers.waiting).toContain(200);
    timers.advance(200);
    await flush();
    expect(timers.waiting).toContain(400);
    timers.advance(400);
    expect(await outcome).toMatchObject({ ok: true });
    expect(core.requests('dispatch').map((r) => r.operationId)).toEqual(['op-1', 'op-1', 'op-1']);
    expect(connection).toEqual(['retrying', 'online']);
    session.dispose();
  });

  it('gives up after 5 attempts: offline and the last error; the next change tries again', async () => {
    const { core, timers, session } = await setup();
    core.respond('dispatch', ...Array.from({ length: 5 }, unavailable));
    const outcome = session.change({ kind: 'dispatch', op: rename('a') });
    for (const wait of [200, 400, 800, 1600]) {
      await flush();
      expect(timers.waiting).toContain(wait);
      timers.advance(wait);
    }
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(core.requests('dispatch')).toHaveLength(5);
    expect(session.connection.get()).toBe('offline');
    expect(await session.change({ kind: 'undo' })).toMatchObject({ ok: true });
    expect(session.connection.get()).toBe('online');
    session.dispose();
  });

  it('SESSION_NOT_FOUND in a transaction: a new session, lost, the steps fail', async () => {
    const { core, session, saved, lost } = await setup();
    core.respond('beginTransaction', {
      result: { readModel: aReadModel({ session: { transaction: { label: 'Edit' } } }) },
    });
    await session.change({ kind: 'begin', label: 'Edit' });
    core.respond('apply', sessionNotFound());
    core.respond('openSession', { sessionId: 'session-2', readModel: aReadModel(), eventSeq: 0n });
    const step = session.change({ kind: 'apply', op: rename('a') });
    const commit = session.change({ kind: 'commit' });
    expect(await step).toMatchObject({ ok: false, error: { reason: 'NO_TRANSACTION' } });
    expect(await commit).toMatchObject({ ok: false, error: { reason: 'NO_TRANSACTION' } });
    expect(lost).toEqual(['transaction']);
    expect(core.requests('openSession').map((r) => r.resumeSessionId)).toEqual(['', '']);
    expect(saved).toEqual(['session-1', 'session-2']);
    expect(core.requests('commit')).toEqual([]);
    await flush();
    expect(core.requests('watchSession').at(-1)?.sessionId).toBe('session-2');
    session.dispose();
  });

  it('SESSION_NOT_FOUND: a durable change goes again with the same id in the new session', async () => {
    const { core, session, lost } = await setup();
    core.respond('dispatch', sessionNotFound());
    core.respond('openSession', { sessionId: 'session-2', readModel: aReadModel() });
    const outcome = await session.change({ kind: 'dispatch', op: rename('a') });
    expect(outcome).toMatchObject({ ok: true });
    expect(core.requests('dispatch').map((r) => [r.sessionId, r.operationId])).toEqual([
      ['session-1', 'op-1'],
      ['session-2', 'op-1'],
    ]);
    expect(lost).toEqual([]);
    session.dispose();
  });

  it('dispose rejects the changes waiting', async () => {
    const { core, session } = await setup();
    core.respond('dispatch', held().answer);
    const a = session.change({ kind: 'dispatch', op: rename('a') });
    const b = session.change({ kind: 'undo' });
    session.dispose();
    await expect(a).rejects.toThrow('disposed');
    await expect(b).rejects.toThrow('disposed');
  });
});

describe('RemoteSession stream', () => {
  const changed = (seq: bigint, by: string) => ({
    event: {
      seq,
      event: { case: 'changed' as const, value: { generation: seq, lastSeq: 0n, bySessionId: by } },
    },
  });

  it('a change of another session reads the read model again', async () => {
    const { core, session } = await setup();
    core.respond('getReadModel', { readModel: aReadModel({ regen: { generation: 9n } }) });
    core.emit(changed(1n, 'session-other'));
    await flush();
    expect(core.requests('getReadModel')).toHaveLength(1);
    expect(session.readModel.get().regen.generation).toBe(9);
    session.dispose();
  });

  it('its own change does not', async () => {
    const { core, session } = await setup();
    core.emit(changed(1n, 'session-1'));
    core.emit({ event: { seq: 1n, event: { case: 'heartbeat', value: {} } } });
    await flush();
    expect(core.requests('getReadModel')).toEqual([]);
    session.dispose();
  });

  it('resync reads the read model again', async () => {
    const { core, session } = await setup();
    core.emit({ event: { seq: 1n, event: { case: 'resync', value: {} } } });
    await flush();
    expect(core.requests('getReadModel')).toHaveLength(1);
    session.dispose();
  });

  it('connects again after the last event it got', async () => {
    const { core, timers, session } = await setup();
    core.emit(changed(1n, 'session-1'));
    core.emit(changed(2n, 'session-1'));
    await flush();
    core.endStreams(unavailable());
    await flush();
    timers.advance(200);
    await flush();
    expect(core.requests('watchSession').map((r) => r.afterSeq)).toEqual([0n, 2n]);
    session.dispose();
  });

  it('SESSION_NOT_FOUND of the stream opens a new session (lost with an open transaction)', async () => {
    const { core, session, lost } = await setup();
    core.respond('beginTransaction', {
      result: { readModel: aReadModel({ session: { transaction: { label: 'Edit' } } }) },
    });
    await session.change({ kind: 'begin', label: 'Edit' });
    core.respond('openSession', { sessionId: 'session-2', readModel: aReadModel(), eventSeq: 3n });
    core.endStreams(sessionNotFound());
    await flush();
    expect(core.requests('openSession')).toHaveLength(2);
    expect(lost).toEqual(['transaction']);
    expect(core.requests('watchSession').at(-1)).toMatchObject({
      sessionId: 'session-2',
      afterSeq: 3n,
    });
    session.dispose();
  });
});

describe('RemoteSession calls', () => {
  it('refresh publishes the read model of GetReadModel', async () => {
    const { core, session, setRead } = await setup();
    setRead({ knownMeshes: ['v1', 'v2'], inputOf: null });
    core.respond('getReadModel', { readModel: aReadModel({ document: { name: 'New' } }) });
    await session.refresh();
    expect(session.readModel.get().document.name).toBe('New');
    expect(core.requests('getReadModel')[0]?.read?.knownMeshes).toEqual(['v1', 'v2']);
    session.dispose();
  });

  // E2E M46: a GetReadModel answered after a change took a newer read model put back the
  // document without the change (the dialog of a new feature then lost its feature).
  it('refresh drops a read model older than the one the session has by then', async () => {
    const { core, session } = await setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    core.respond('getReadModel', async () => {
      await gate;
      return { readModel: aReadModel({ document: { name: 'Stale' }, regen: { generation: 1n } }) };
    });
    core.respond('dispatch', {
      result: { readModel: aReadModel({ document: { name: 'Fresh' }, regen: { generation: 2n } }) },
    });
    const refreshed = session.refresh();
    await flush();
    await session.change({ kind: 'dispatch', op: rename('x') });
    expect(session.readModel.get().document.name).toBe('Fresh');
    release();
    await refreshed;
    expect(session.readModel.get().document.name).toBe('Fresh');
    session.dispose();
  });

  it('refresh after SESSION_NOT_FOUND opens a new session and reads again', async () => {
    const { core, session } = await setup();
    core.respond('getReadModel', sessionNotFound());
    core.respond('openSession', { sessionId: 'session-2', readModel: aReadModel() });
    await session.refresh();
    expect(core.requests('getReadModel').map((r) => r.sessionId)).toEqual([
      'session-1',
      'session-2',
    ]);
    session.dispose();
  });

  it('refresh rejects with RemoteError after the attempts', async () => {
    const { core, timers, session } = await setup();
    core.respond('getReadModel', ...Array.from({ length: 5 }, unavailable));
    const refreshed = session.refresh();
    for (const wait of [200, 400, 800, 1600]) {
      await flush();
      timers.advance(wait);
    }
    await expect(refreshed).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    session.dispose();
  });

  it('history decodes GetHistory from the given seq', async () => {
    const { core, session } = await setup();
    core.respond('getHistory', {
      entries: [{ seq: 1n, kind: 1, label: 'Add', opType: 'feature.add' }],
      undoStack: [1n],
      redoStack: [],
    });
    const history = await session.history(1);
    expect(history.entries.map((e) => e.opType)).toEqual(['feature.add']);
    expect(history.stacks).toEqual({ undo: [1], redo: [] });
    expect(core.requests('getHistory')[0]?.fromSeq).toBe(1n);
    session.dispose();
  });

  it('exportStep returns the file', async () => {
    const { core, session } = await setup();
    const content = new Uint8Array([1, 2, 3]);
    core.respond('exportStep', { content, fileName: 'Doc.step' });
    expect(await session.exportStep()).toEqual({ content, fileName: 'Doc.step' });
    session.dispose();
  });

  it('close sends CloseSession with keepalive and stops the stream', async () => {
    const { core, session, keepalive, timers } = await setup();
    await session.close();
    expect(core.requests('closeSession')).toMatchObject([{ sessionId: 'session-1' }]);
    expect(keepalive.filter(([m]) => m === 'closeSession')).toEqual([['closeSession', '1']]);
    expect(keepalive.filter(([, k]) => k !== null)).toHaveLength(1);
    await flush();
    expect(core.openStreams).toBe(0);
    timers.advance(100_000);
    await flush();
    expect(core.requests('watchSession')).toHaveLength(1);
    session.dispose();
  });
});
