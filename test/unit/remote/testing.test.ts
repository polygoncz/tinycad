import { Code, ConnectError, createClient } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { DocumentService, ErrorReason, SessionService } from '@/protocol';
import {
  aCoreError,
  aReadModel,
  createFakeCore,
  decodeReadModel,
  toRemoteError,
} from '@/remote/testing';

function clients() {
  const core = createFakeCore();
  return {
    core,
    sessions: createClient(SessionService, core.transport),
    documents: createClient(DocumentService, core.transport),
  };
}

describe('createFakeCore', () => {
  it('answers from the queue of the method, in order, then by the fallback', async () => {
    const { core, sessions } = clients();
    core.respond(
      'getReadModel',
      { readModel: aReadModel({ regen: { generation: 7n } }) },
      { readModel: aReadModel({ regen: { generation: 8n } }) },
    );
    const generation = async () =>
      (await sessions.getReadModel({ sessionId: 's' })).readModel?.regen?.generation;
    expect(await generation()).toBe(7n);
    expect(await generation()).toBe(8n);
    expect(await generation()).toBe(1n);
  });

  it('records every request in order', async () => {
    const { core, sessions, documents } = clients();
    await sessions.openSession({ documentId: 'doc-1', resumeSessionId: 'old' });
    await documents.listDocuments({});
    await sessions.dispatch({ sessionId: 'session-1', operationId: 'op-1' });
    expect(core.calls).toEqual(['openSession', 'listDocuments', 'dispatch']);
    expect(core.requests('openSession').map((r) => r.resumeSessionId)).toEqual(['old']);
    expect(core.requests('dispatch').map((r) => r.operationId)).toEqual(['op-1']);
    expect(core.requests('commit')).toEqual([]);
  });

  it('has fallbacks a client can decode', async () => {
    const { sessions } = clients();
    const opened = await sessions.openSession({ documentId: 'doc-1' });
    expect(opened.sessionId).toBe('session-1');
    expect(decodeReadModel(opened.readModel ?? aReadModel()).document.id).toBe('doc-1');
    const changed = await sessions.apply({ sessionId: 'session-1' });
    expect(changed.result?.readModel).toBeDefined();
  });

  it('a fallback replaces the default answer', async () => {
    const { core, documents } = clients();
    core.fallback('listDocuments', { documents: [{ documentId: 'd', name: 'D' }] });
    expect((await documents.listDocuments({})).documents.map((d) => d.name)).toEqual(['D']);
    expect((await documents.listDocuments({})).documents.map((d) => d.name)).toEqual(['D']);
  });

  it('sends an error answer with its ErrorDetail', async () => {
    const { core, sessions } = clients();
    core.respond(
      'commit',
      aCoreError(Code.FailedPrecondition, ErrorReason.NO_TRANSACTION, { path: 'x' }),
    );
    const error = await sessions.commit({}).then(
      () => null,
      (e: unknown) => toRemoteError(e),
    );
    expect(error).toMatchObject({
      code: 'FAILED_PRECONDITION',
      reason: 'NO_TRANSACTION',
      path: 'x',
    });
  });

  it('answers with a function of the request, also later', async () => {
    const { core, documents } = clients();
    let release: () => void = () => undefined;
    core.respond('createDocument', async (request) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { document: { documentId: 'new', name: request.name } };
    });
    const created = documents.createDocument({ operationId: 'op', name: 'Bracket' });
    await waitFor(() => core.requests('createDocument').length === 1);
    release();
    expect((await created).document?.name).toBe('Bracket');
  });

  it('a function may throw an error', async () => {
    const { core, sessions } = clients();
    core.respond('undo', () => {
      throw new ConnectError('down', Code.Unavailable);
    });
    await expect(sessions.undo({})).rejects.toMatchObject({ code: Code.Unavailable });
  });

  it('streams the events of WatchSession until the test ends the stream', async () => {
    const { core, sessions } = clients();
    const stream = sessions.watchSession({ sessionId: 'session-1', afterSeq: 4n });
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    await waitFor(() => core.openStreams === 1);
    expect(core.requests('watchSession').map((r) => r.afterSeq)).toEqual([4n]);
    core.emit({ event: { seq: 5n, event: { case: 'resync', value: {} } } });
    expect(valueOf(await first).event?.seq).toBe(5n);
    core.emit({
      event: { seq: 6n, event: { case: 'changed', value: { generation: 2n, bySessionId: 'x' } } },
    });
    expect(valueOf(await iterator.next()).event?.event.case).toBe('changed');
    core.endStreams();
    expect((await iterator.next()).done).toBe(true);
    await waitFor(() => core.openStreams === 0);
  });

  it('ends the streams with an error', async () => {
    const { core, sessions } = clients();
    const iterator = sessions.watchSession({ sessionId: 's' })[Symbol.asyncIterator]();
    const next = iterator.next();
    await waitFor(() => core.openStreams === 1);
    core.endStreams(new ConnectError('gone', Code.Unavailable));
    await expect(next).rejects.toMatchObject({ code: Code.Unavailable });
  });

  it('closes a stream the client cancels', async () => {
    const { core, sessions } = clients();
    const abort = new AbortController();
    const iterator = sessions
      .watchSession({ sessionId: 's' }, { signal: abort.signal })
      [Symbol.asyncIterator]();
    const next = iterator.next();
    await waitFor(() => core.openStreams === 1);
    abort.abort();
    await expect(next).rejects.toBeDefined();
    await waitFor(() => core.openStreams === 0);
  });
});

/** The value of a step of a stream that did not end. */
function valueOf<T>(result: IteratorResult<T>): T {
  if (result.done === true) throw new Error('the stream ended');
  return result.value;
}

/** Lets the router transport deliver what is pending until `done` holds (bounded). */
async function waitFor(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(done()).toBe(true);
}
