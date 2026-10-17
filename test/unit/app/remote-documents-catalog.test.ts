import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { Code } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { createDocumentListModel } from '@/interaction';
import { createRemoteDocuments } from '@/remote';
import { aCoreError, createFakeCore } from '@/remote/testing';
import { createRemoteDocumentsCatalog } from '@/app/remote-documents-catalog';

// Values of ErrorReason of errors.proto: tests of app may not import protocol, so the fake core
// gets the numbers (in the domain of the enum, so they type-check).
const REASON = { INVALID_DOCUMENT: 12, STORAGE: 16, DOCUMENT_OPEN: 17 } as const;

const DOC = 'doc-1' as DocumentId; // an id of the catalog of the server

function summary(id: string, name: string, created = 10, updated = 20) {
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
  const catalog = createRemoteDocumentsCatalog({
    documents,
    translate: (key) => (key === 'document.untitled' ? 'Bez názvu' : key),
  });
  return { core, catalog };
}

describe('createRemoteDocumentsCatalog', () => {
  it('lists the documents of the server, newest first as it sends them', async () => {
    const { core, catalog } = setup();
    core.respond('listDocuments', {
      documents: [summary('b', 'B', 1000, 5000), summary('a', 'A', 2000, 3000)],
    });
    expect(await catalog.list()).toEqual([
      { meta: { id: 'b', name: 'B', createdAt: 1000 }, updatedAt: 5000 },
      { meta: { id: 'a', name: 'A', createdAt: 2000 }, updatedAt: 3000 },
    ]);
  });

  it('creates a document named by the translation of document.untitled', async () => {
    const { core, catalog } = setup();
    core.respond('createDocument', { document: summary('n', 'Bez názvu') });
    expect(await catalog.create()).toBe('n');
    expect(core.requests('createDocument')).toMatchObject([{ name: 'Bez názvu' }]);
  });

  it('renames a document through RenameDocument', async () => {
    const { core, catalog } = setup();
    core.respond('renameDocument', { document: summary(DOC, 'Bracket') });
    await catalog.rename(DOC, 'Bracket');
    expect(core.requests('renameDocument')).toMatchObject([{ documentId: DOC, name: 'Bracket' }]);
  });

  it('deletes a document through DeleteDocument', async () => {
    const { core, catalog } = setup();
    await catalog.remove(DOC);
    expect(core.requests('deleteDocument')).toMatchObject([{ documentId: DOC }]);
  });

  it('DOCUMENT_OPEN on delete shows the error of a document open in another tab', async () => {
    const { core, catalog } = setup();
    core.respond('listDocuments', { documents: [summary(DOC, 'Part')] });
    core.respond('deleteDocument', aCoreError(Code.FailedPrecondition, REASON.DOCUMENT_OPEN));
    const model = createDocumentListModel({ catalog, confirm: () => true });
    await model.load();
    const state = model.list.get();
    if (state.kind !== 'loaded') throw new Error('expected the list');
    const [entry] = state.documents;
    if (entry === undefined) throw new Error('expected a document');
    await model.remove(entry);
    expect(model.error.get()).toEqual({
      key: 'documents.error.delete',
      params: { error: `Document '${DOC}' is open in another tab` },
      detail: null,
    });
  });

  it('DOCUMENT_OPEN on rename is refused the same way', async () => {
    const { core, catalog } = setup();
    core.respond('renameDocument', aCoreError(Code.FailedPrecondition, REASON.DOCUMENT_OPEN));
    await expect(catalog.rename(DOC, 'X')).rejects.toThrow(
      `Document '${DOC}' is open in another tab`,
    );
  });

  it('imports a parsed file as its JSON bytes', async () => {
    const { core, catalog } = setup();
    core.respond('importDocument', { document: summary('imp', 'Imported') });
    const raw = { format: 'tinycad.file', formatVersion: 2 };
    expect(await catalog.importFile(raw)).toEqual({ ok: true, value: 'imp' });
    const [request] = core.requests('importDocument');
    expect(JSON.parse(new TextDecoder().decode(request?.content))).toEqual(raw);
  });

  it('an import refused with INVALID_DOCUMENT is an error with the load issues', async () => {
    const { core, catalog } = setup();
    core.respond(
      'importDocument',
      aCoreError(Code.InvalidArgument, REASON.INVALID_DOCUMENT, {
        path: 'snapshot.document.studio.features[0].id',
        issues: [
          {
            param: 'snapshot.document.studio.features[0].id',
            code: 'document.loadIssue',
            values: { message: { value: { case: 'text', value: 'duplicate id' } } },
          },
        ],
      }),
    );
    expect(await catalog.importFile({})).toEqual({
      ok: false,
      error: {
        issues: [{ path: 'snapshot.document.studio.features[0].id', message: 'duplicate id' }],
      },
    });
  });

  it('another failure of the import rejects', async () => {
    const { core, catalog } = setup();
    core.respond('importDocument', aCoreError(Code.Internal, REASON.STORAGE));
    await expect(catalog.importFile({})).rejects.toMatchObject({ reason: 'STORAGE' });
  });
});
