import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { Code } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { ErrorReason } from '@/protocol';
import { createRemoteDocuments, RemoteError } from '@/remote';
import { aCoreError, createFakeCore } from '@/remote/testing';

const DOC = 'doc-1' as DocumentId; // an id of the catalog of the server

function summary(id: string, name: string, created: number, updated: number) {
  return {
    documentId: id,
    name,
    created: timestampFromMs(created),
    updated: timestampFromMs(updated),
  };
}

function setup() {
  const core = createFakeCore();
  let next = 0;
  const documents = createRemoteDocuments(core.transport, () => `op-${String(++next)}`);
  return { core, documents };
}

async function failureOf(promise: Promise<unknown>): Promise<RemoteError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof RemoteError)) throw new Error('expected a RemoteError');
  return error;
}

describe('createRemoteDocuments', () => {
  it('list returns the summaries in the order of the server', async () => {
    const { core, documents } = setup();
    core.respond('listDocuments', {
      documents: [summary('b', 'B', 1000, 5000), summary('a', 'A', 2000, 3000)],
    });
    expect(await documents.list()).toEqual([
      { meta: { id: 'b', name: 'B', createdAt: 1000 }, updatedAt: 5000 },
      { meta: { id: 'a', name: 'A', createdAt: 2000 }, updatedAt: 3000 },
    ]);
  });

  it('create sends the name with a new operation_id', async () => {
    const { core, documents } = setup();
    core.respond('createDocument', { document: summary('n', 'New', 10, 10) });
    expect(await documents.create('New')).toEqual({
      meta: { id: 'n', name: 'New', createdAt: 10 },
      updatedAt: 10,
    });
    expect(core.requests('createDocument')).toMatchObject([{ operationId: 'op-1', name: 'New' }]);
  });

  it('rename sends the id and the name with a new operation_id', async () => {
    const { core, documents } = setup();
    core.respond('renameDocument', { document: summary('doc-1', 'Renamed', 10, 20) });
    expect((await documents.rename(DOC, 'Renamed')).meta.name).toBe('Renamed');
    expect(core.requests('renameDocument')).toMatchObject([
      { operationId: 'op-1', documentId: 'doc-1', name: 'Renamed' },
    ]);
  });

  it('remove sends the id', async () => {
    const { core, documents } = setup();
    await documents.remove(DOC);
    expect(core.requests('deleteDocument')).toMatchObject([{ documentId: 'doc-1' }]);
  });

  it('importFile sends the bytes with the given or a new operation_id', async () => {
    const { core, documents } = setup();
    core.fallback('importDocument', { document: summary('i', 'Imported', 1, 2) });
    const bytes = new TextEncoder().encode('{"format":"tinycad"}');
    expect((await documents.importFile(bytes, 'import:abc')).meta.id).toBe('i');
    await documents.importFile(bytes);
    const requests = core.requests('importDocument');
    expect(requests.map((r) => r.operationId)).toEqual(['import:abc', 'op-1']);
    expect(requests[0]?.content).toEqual(bytes);
  });

  it('exportFile returns the content and the file name', async () => {
    const { core, documents } = setup();
    const content = new TextEncoder().encode('{}');
    core.respond('exportDocument', { content, fileName: 'Doc.tinycad.json' });
    expect(await documents.exportFile(DOC)).toEqual({ content, fileName: 'Doc.tinycad.json' });
    expect(core.requests('exportDocument')).toMatchObject([{ documentId: 'doc-1' }]);
  });

  it('a failure rejects as RemoteError: DOCUMENT_OPEN', async () => {
    const { core, documents } = setup();
    core.respond('deleteDocument', aCoreError(Code.FailedPrecondition, ErrorReason.DOCUMENT_OPEN));
    expect(await failureOf(documents.remove(DOC))).toMatchObject({
      code: 'FAILED_PRECONDITION',
      reason: 'DOCUMENT_OPEN',
    });
  });

  it('a failure rejects as RemoteError: INVALID_DOCUMENT with issues', async () => {
    const { core, documents } = setup();
    core.respond(
      'importDocument',
      aCoreError(Code.InvalidArgument, ErrorReason.INVALID_DOCUMENT, {
        issues: [{ param: 'features', code: 'file.invalid' }],
      }),
    );
    const error = await failureOf(documents.importFile(new Uint8Array()));
    expect(error.reason).toBe('INVALID_DOCUMENT');
    expect(error.issues).toEqual([{ param: 'features', code: 'file.invalid' }]);
  });

  it('an answer without its summary is INTERNAL', async () => {
    const { documents } = setup();
    expect((await failureOf(documents.create('x'))).code).toBe('INTERNAL');
  });
});
