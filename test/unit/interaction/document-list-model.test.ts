import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { DocumentId, DocumentLoadError } from '@/document';
import type { ConfirmRequest } from '@/interaction/builtin-actions';
import { createDocumentListModel, importDocumentText } from '@/interaction/document-list-model';
import type {
  DocumentCatalog,
  DocumentCatalogEntry,
  DocumentListModel,
} from '@/interaction/document-list-model';

// The document list (spec 11, "Seznam dokumentů") as a presentation model (M20, A3.5): loading,
// busy, the confirmation of a delete, the order delete → load, renaming and import.

/** DocumentId is a branded string; test ids are trusted. */
function id(text: string): DocumentId {
  return text as DocumentId;
}

function anEntry(name: string, updatedAt = 0): DocumentCatalogEntry {
  return { meta: { id: id(name), name, createdAt: 0 }, updatedAt };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A catalog over an array; every call is recorded in `calls`. */
function aCatalog(entries: DocumentCatalogEntry[] = [anEntry('a'), anEntry('b')]) {
  const calls: string[] = [];
  const catalog = {
    list: vi.fn((): Promise<readonly DocumentCatalogEntry[]> => {
      calls.push('list');
      return Promise.resolve([...entries]);
    }),
    create: vi.fn((): Promise<DocumentId> => {
      calls.push('create');
      return Promise.resolve(id('new'));
    }),
    importFile: vi.fn((raw: unknown): Promise<Result<DocumentId, DocumentLoadError>> => {
      calls.push(`import ${JSON.stringify(raw)}`);
      return Promise.resolve(ok(id('imported')));
    }),
    remove: vi.fn((doc: DocumentId): Promise<void> => {
      calls.push(`remove ${doc}`);
      entries = entries.filter((e) => e.meta.id !== doc);
      return Promise.resolve();
    }),
    rename: vi.fn((doc: DocumentId, name: string): Promise<void> => {
      calls.push(`rename ${doc} ${name}`);
      return Promise.resolve();
    }),
  } satisfies DocumentCatalog;
  return { catalog, calls };
}

function setup(
  options: {
    catalog?: DocumentCatalog;
    confirm?: (request: ConfirmRequest) => boolean | Promise<boolean>;
  } = {},
) {
  const fake = aCatalog();
  const catalog = options.catalog ?? fake.catalog;
  const confirm = vi.fn(options.confirm ?? (() => true));
  const model = createDocumentListModel({ catalog, confirm });
  return { model, catalog: fake.catalog, calls: fake.calls, confirm };
}

function errorKey(model: DocumentListModel): string | null {
  return model.error.get()?.key ?? null;
}

describe('createDocumentListModel – loading', () => {
  it('starts loading, not busy, without an error or a rename', () => {
    const { model } = setup();
    expect(model.list.get()).toEqual({ kind: 'loading' });
    expect(model.busy.get()).toBe(false);
    expect(model.error.get()).toBeNull();
    expect(model.renaming.get()).toBeNull();
  });

  it('load → loaded with the list of the catalog, frozen', async () => {
    const { model } = setup();
    await model.load();
    expect(model.list.get()).toEqual({ kind: 'loaded', documents: [anEntry('a'), anEntry('b')] });
    expect(Object.isFrozen(model.list.get())).toBe(true);
  });

  it('an empty list is loaded too', async () => {
    const { model } = setup({ catalog: aCatalog([]).catalog });
    await model.load();
    expect(model.list.get()).toEqual({ kind: 'loaded', documents: [] });
  });

  it('a rejection → failed with its message, never a rejection (no endless "Loading…")', async () => {
    const { catalog } = aCatalog();
    catalog.list.mockImplementation(() => Promise.reject(new Error('IndexedDB is blocked')));
    const { model } = setup({ catalog });
    await model.load();
    expect(model.list.get()).toEqual({ kind: 'failed', error: 'IndexedDB is blocked' });
  });

  it('a reason that is not an Error is its String', async () => {
    const { catalog } = aCatalog();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a reason that is not an Error, as IndexedDB code may give
    catalog.list.mockImplementation(() => Promise.reject('private mode'));
    const { model } = setup({ catalog });
    await model.load();
    expect(model.list.get()).toEqual({ kind: 'failed', error: 'private mode' });
  });

  it('a list that throws → failed', async () => {
    const { catalog } = aCatalog();
    catalog.list.mockImplementation(() => {
      throw new Error('no IndexedDB');
    });
    const { model } = setup({ catalog });
    await model.load();
    expect(model.list.get()).toEqual({ kind: 'failed', error: 'no IndexedDB' });
  });

  it('load again keeps the cards until the new list is there', async () => {
    const { catalog } = aCatalog();
    const { model } = setup({ catalog });
    await model.load();
    const next = deferred<readonly DocumentCatalogEntry[]>();
    catalog.list.mockImplementation(() => next.promise);
    const loading = model.load();
    expect(model.list.get()).toMatchObject({ kind: 'loaded' });
    next.resolve([anEntry('c')]);
    await loading;
    expect(model.list.get()).toEqual({ kind: 'loaded', documents: [anEntry('c')] });
  });

  it('retry shows loading until it settles', async () => {
    const { catalog } = aCatalog();
    catalog.list.mockImplementationOnce(() => Promise.reject(new Error('x')));
    const { model } = setup({ catalog });
    await model.load();
    const retrying = model.retry();
    expect(model.list.get()).toEqual({ kind: 'loading' });
    await retrying;
    expect(model.list.get()).toMatchObject({ kind: 'loaded' });
  });
});

describe('createDocumentListModel – create', () => {
  it('creates a document and returns its id; busy while it runs', async () => {
    const { catalog } = aCatalog();
    const created = deferred<DocumentId>();
    catalog.create.mockImplementation(() => created.promise);
    const { model } = setup({ catalog });
    const creating = model.create();
    expect(model.busy.get()).toBe(true);
    created.resolve(id('new'));
    expect(await creating).toBe('new');
    expect(model.busy.get()).toBe(false);
  });

  it('a failure is the error documents.error.create; busy returns to false', async () => {
    const { catalog } = aCatalog();
    catalog.create.mockImplementation(() => Promise.reject(new Error('quota')));
    const { model } = setup({ catalog });
    expect(await model.create()).toBeNull();
    expect(model.error.get()).toEqual({
      key: 'documents.error.create',
      params: { error: 'quota' },
      detail: null,
    });
    expect(model.busy.get()).toBe(false);
  });
});

describe('createDocumentListModel – delete', () => {
  it('asks first, then deletes and loads the list again, in this order', async () => {
    const { model, calls, confirm } = setup();
    await model.load();
    calls.length = 0;
    await model.remove(anEntry('a'));
    expect(confirm).toHaveBeenCalledWith({ key: 'documents.confirmDelete', params: { name: 'a' } });
    expect(calls).toEqual(['remove a', 'list']);
    expect(model.list.get()).toEqual({ kind: 'loaded', documents: [anEntry('b')] });
  });

  it('a refused confirmation deletes nothing', async () => {
    const { model, calls } = setup({ confirm: () => false });
    await model.remove(anEntry('a'));
    expect(calls).toEqual([]);
    expect(model.busy.get()).toBe(false);
  });

  it('an asynchronous confirmation is awaited', async () => {
    const answer = deferred<boolean>();
    const { model, calls } = setup({ confirm: () => answer.promise });
    const removing = model.remove(anEntry('a'));
    expect(calls).toEqual([]);
    answer.resolve(true);
    await removing;
    expect(calls).toEqual(['remove a', 'list']);
  });

  it('a failure is the error documents.error.delete; busy returns to false', async () => {
    const { catalog } = aCatalog();
    catalog.remove.mockImplementation(() => Promise.reject(new Error('open in another tab')));
    const { model } = setup({ catalog });
    await model.remove(anEntry('a'));
    expect(model.error.get()).toEqual({
      key: 'documents.error.delete',
      params: { error: 'open in another tab' },
      detail: null,
    });
    expect(model.busy.get()).toBe(false);
  });

  it('a new action clears the error of the last one', async () => {
    const { catalog } = aCatalog();
    catalog.remove.mockImplementationOnce(() => Promise.reject(new Error('x')));
    const { model } = setup({ catalog });
    await model.remove(anEntry('a'));
    expect(errorKey(model)).toBe('documents.error.delete');
    await model.remove(anEntry('a'));
    expect(model.error.get()).toBeNull();
  });
});

describe('createDocumentListModel – busy', () => {
  it('blocks a second action while one runs', async () => {
    const { catalog, calls } = aCatalog();
    const created = deferred<DocumentId>();
    catalog.create.mockImplementation(() => {
      calls.push('create');
      return created.promise;
    });
    const { model, confirm } = setup({ catalog });
    const creating = model.create();
    expect(await model.create()).toBeNull();
    await model.remove(anEntry('a'));
    expect(await model.importFile(() => Promise.resolve('{}'))).toBeNull();
    expect(model.beginRename(id('a'))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(['create']);
    created.resolve(id('new'));
    await creating;
  });
});

describe('createDocumentListModel – rename', () => {
  it('beginRename marks the card, cancelRename ends it without a call', () => {
    const { model, calls } = setup();
    expect(model.beginRename(id('a'))).toBe(true);
    expect(model.renaming.get()).toBe('a');
    model.cancelRename();
    expect(model.renaming.get()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('commitRename renames the card being edited and loads the list again', async () => {
    const { model, calls } = setup();
    model.beginRename(id('a'));
    await model.commitRename(anEntry('a'), 'Bracket');
    expect(model.renaming.get()).toBeNull();
    expect(calls).toEqual(['rename a Bracket', 'list']);
  });

  it('the same name ends the edit without a call', async () => {
    const { model, calls } = setup();
    model.beginRename(id('a'));
    await model.commitRename(anEntry('a'), 'a');
    expect(model.renaming.get()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a second commit (blur after Enter) does nothing', async () => {
    const { model, calls } = setup();
    model.beginRename(id('a'));
    await model.commitRename(anEntry('a'), 'Bracket');
    await model.commitRename(anEntry('a'), 'Bracket');
    expect(calls).toEqual(['rename a Bracket', 'list']);
  });

  it('a failure is the error documents.error.rename; busy returns to false', async () => {
    const { catalog } = aCatalog();
    catalog.rename.mockImplementation(() => Promise.reject(new Error('empty name')));
    const { model } = setup({ catalog });
    model.beginRename(id('a'));
    await model.commitRename(anEntry('a'), ' ');
    expect(model.error.get()).toEqual({
      key: 'documents.error.rename',
      params: { error: 'empty name' },
      detail: null,
    });
    expect(model.busy.get()).toBe(false);
  });
});

describe('createDocumentListModel – import', () => {
  it('reads the text, imports the parsed file and returns the new id', async () => {
    const { model, calls } = setup();
    expect(await model.importFile(() => Promise.resolve('{"format":"tinycad.file"}'))).toBe(
      'imported',
    );
    expect(calls).toEqual(['import {"format":"tinycad.file"}']);
    expect(model.busy.get()).toBe(false);
  });

  it('a refused file is the error documents.importError with its detail', async () => {
    const { catalog } = aCatalog();
    catalog.importFile.mockImplementation(() =>
      Promise.resolve(err({ issues: [{ path: 'formatVersion', message: 'Unsupported' }] })),
    );
    const { model } = setup({ catalog });
    expect(await model.importFile(() => Promise.resolve('{}'))).toBeNull();
    expect(model.error.get()).toEqual({
      key: 'documents.importError',
      params: {},
      detail: 'formatVersion: Unsupported',
    });
  });

  it('a file that cannot be read is the error with its message', async () => {
    const { model, calls } = setup();
    expect(await model.importFile(() => Promise.reject(new Error('NotReadableError')))).toBeNull();
    expect(model.error.get()).toEqual({
      key: 'documents.importError',
      params: {},
      detail: 'NotReadableError',
    });
    expect(calls).toEqual([]);
    expect(model.busy.get()).toBe(false);
  });
});

// DocumentId is a branded string; the tests may not import the parser of document.
const ID = id('doc-1');

type ImportFile = (raw: unknown) => Promise<Result<DocumentId, DocumentLoadError>>;

describe('importDocumentText', () => {
  it('parses the text and returns the id of the new document', async () => {
    const seen: unknown[] = [];
    const importFile: ImportFile = (raw) => {
      seen.push(raw);
      return Promise.resolve(ok(ID));
    };
    expect(await importDocumentText('{"format":"tinycad.file"}', importFile)).toEqual({
      ok: true,
      id: ID,
    });
    expect(seen).toEqual([{ format: 'tinycad.file' }]);
  });

  it('a text that is not JSON is an error without calling import', async () => {
    let called = false;
    const importFile: ImportFile = () => {
      called = true;
      return Promise.resolve(ok(ID));
    };
    const outcome = await importDocumentText('not json', importFile);
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('a refused file gives its first issue as the detail', async () => {
    const importFile: ImportFile = () =>
      Promise.resolve(
        err({
          issues: [
            { path: 'formatVersion', message: 'Unsupported version' },
            { path: 'snapshot', message: 'Other' },
          ],
        }),
      );
    expect(await importDocumentText('{}', importFile)).toEqual({
      ok: false,
      detail: 'formatVersion: Unsupported version',
    });
  });

  it('a rejected import (storage error) is an error with its message', async () => {
    const importFile: ImportFile = () => Promise.reject(new Error('Quota exceeded'));
    expect(await importDocumentText('{}', importFile)).toEqual({
      ok: false,
      detail: 'Quota exceeded',
    });
  });

  it('a refusal without issues has no detail', async () => {
    const importFile: ImportFile = () => Promise.resolve(err({ issues: [] }));
    expect(await importDocumentText('{}', importFile)).toEqual({ ok: false, detail: null });
  });
});
