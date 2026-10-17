// Moving the documents of the browser to the core (N71, upřesnění N38): every document stored in
// IndexedDB is exported the way the File menu exported it (exportStoredDocument, with its history)
// and sent as ImportDocument. The operation_id is import:<sha256 of the file>, the key
// tinycad-import uses too, so a repeated run creates no duplicates. IndexedDB is never deleted:
// M47 removes it from the client, the data stay in the browser until then.

import type { DocumentStore } from '@/persistence';
import { exportStoredDocument } from '@/persistence';
import type { FeaturePlugin } from '@/plugin-api';
import { RemoteError } from '@/remote';
import type { RemoteDocuments } from '@/remote';
import { describeLoadError } from './load-error';
import { createPluginRegistries } from './registries';

export interface BrowserMigrationDeps {
  readonly documents: Pick<RemoteDocuments, 'importFile'>;
  /**
   * The store of the documents of the browser for one call (IndexedDB); rejects when there is
   * none.
   */
  readonly withStore: <T>(call: (store: DocumentStore) => Promise<T>) => Promise<T>;
  /** The registries the stored log is replayed with (the local plugins). */
  readonly plugins: readonly FeaturePlugin[];
}

/** A document that did not move: its name and the technical text of the failure. */
export interface MigrationFailure {
  readonly name: string;
  readonly error: string;
}

export interface MigrationReport {
  /** Documents the core has now (a repeated one counts too: the core answers with it). */
  readonly migrated: number;
  readonly failures: readonly MigrationFailure[];
}

export interface BrowserMigration {
  /** The number of documents in the browser; 0 without IndexedDB or when it cannot be read. */
  count(): Promise<number>;
  /**
   * Moves every document of the browser, one after another; `onProgress(done, total)` before the
   * first and after each. A failure of one document is in the report; rejects only when the list
   * of the browser cannot be read.
   */
  run(onProgress?: (done: number, total: number) => void): Promise<MigrationReport>;
}

export function createBrowserMigration(deps: BrowserMigrationDeps): BrowserMigration {
  const { documents, withStore } = deps;
  return Object.freeze({
    async count(): Promise<number> {
      try {
        return (await withStore((store) => store.listDocuments())).length;
      } catch {
        return 0;
      }
    },

    run(onProgress?: (done: number, total: number) => void): Promise<MigrationReport> {
      const { schemas, handlers } = createPluginRegistries(deps.plugins);
      return withStore(async (store) => {
        const stored = await store.listDocuments();
        const failures: MigrationFailure[] = [];
        let migrated = 0;
        onProgress?.(0, stored.length);
        for (const [i, info] of stored.entries()) {
          try {
            const file = await exportStoredDocument(store, info.meta.id, { schemas, handlers });
            if (!file.ok) throw new Error(describeLoadError(file.error));
            // The bytes of the File menu's download, so the key is the one of that file.
            const content = new TextEncoder().encode(`${JSON.stringify(file.value, null, 2)}\n`);
            await documents.importFile(content, `import:${await sha256Hex(content)}`);
            migrated += 1;
          } catch (e) {
            failures.push(Object.freeze({ name: info.meta.name, error: errorText(e) }));
          }
          onProgress?.(i + 1, stored.length);
        }
        return Object.freeze({ migrated, failures: Object.freeze(failures) });
      });
    },
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The reason of a refusal of the core first: its message is only technical (spec 14). */
function errorText(e: unknown): string {
  if (e instanceof RemoteError && e.reason !== 'UNSPECIFIED') return `${e.reason}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
