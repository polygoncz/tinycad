import { createHash } from 'node:crypto';
import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { Code } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { boxPlugin } from '@/features/box';
import { createMemoryDocumentStore } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createRemoteDocuments } from '@/remote';
import { aCoreError, createFakeCore } from '@/remote/testing';
import { createBrowserMigration } from '@/app/browser-migration';
import { storeNewDocument } from '@/app/open-document';

// Values of ErrorReason of errors.proto: tests of app may not import protocol, so the fake core
// gets the numbers (in the domain of the enum, so they type-check).
const REASON = { STORAGE: 16 } as const;

async function aStoreWith(names: readonly string[]): Promise<DocumentStore> {
  const store = createMemoryDocumentStore({ now: () => 0 });
  for (const [i, name] of names.entries()) {
    // Test ids are trusted.
    await storeNewDocument(store, `local-${String(i)}` as DocumentId, {
      translate: () => name,
      now: () => 1000 + i,
    });
  }
  return store;
}

/** A fake core whose ImportDocument stores one document per operation_id, like the server. */
function aCore() {
  const core = createFakeCore();
  const imported = new Map<string, string>();
  core.fallback('importDocument', (request) => {
    let id = imported.get(request.operationId);
    if (id === undefined) {
      id = `srv-${String(imported.size + 1)}`;
      imported.set(request.operationId, id);
    }
    return {
      document: {
        documentId: id,
        name: id,
        created: timestampFromMs(0),
        updated: timestampFromMs(0),
      },
    };
  });
  let next = 0;
  const documents = createRemoteDocuments(core.transport, () => `op-${String(++next)}`);
  return { core, documents, imported };
}

function setup(store: DocumentStore | null) {
  const { core, documents, imported } = aCore();
  const migration = createBrowserMigration({
    documents,
    plugins: [boxPlugin],
    withStore: (call) => (store === null ? Promise.reject(new Error('no IndexedDB')) : call(store)),
  });
  return { core, migration, imported };
}

describe('createBrowserMigration', () => {
  it('count is the number of documents in the browser', async () => {
    const { migration } = setup(await aStoreWith(['A', 'B']));
    expect(await migration.count()).toBe(2);
  });

  it('count is 0 without a store of the browser', async () => {
    const { migration } = setup(null);
    expect(await migration.count()).toBe(0);
  });

  it('imports every document with operation_id import:<sha256 of the file>', async () => {
    const { core, migration } = setup(await aStoreWith(['A', 'B']));
    const progress: [number, number][] = [];
    const report = await migration.run((done, total) => progress.push([done, total]));
    expect(report).toEqual({ migrated: 2, failures: [] });
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    const requests = core.requests('importDocument');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const sha = createHash('sha256').update(request.content).digest('hex');
      expect(request.operationId).toBe(`import:${sha}`);
      expect(JSON.parse(new TextDecoder().decode(request.content))).toMatchObject({
        format: 'tinycad.file',
      });
    }
  });

  it('a second run creates no duplicates and keeps IndexedDB', async () => {
    const store = await aStoreWith(['A', 'B']);
    const { migration, imported } = setup(store);
    await migration.run();
    await migration.run();
    expect(imported.size).toBe(2);
    expect(await store.listDocuments()).toHaveLength(2);
  });

  it('a refused document is a failure with its name and text; the rest go on', async () => {
    const { core, migration } = setup(await aStoreWith(['A', 'B']));
    core.respond('importDocument', aCoreError(Code.Internal, REASON.STORAGE));
    const report = await migration.run();
    expect(report.migrated).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.name).toMatch(/^[AB]$/);
    expect(report.failures[0]?.error).toContain('STORAGE');
  });

  it('run rejects when the store of the browser cannot be read', async () => {
    const { migration } = setup(null);
    await expect(migration.run()).rejects.toThrow('no IndexedDB');
  });
});
