import { err, ok } from '@/core';
import type { RegistryReader, Result } from '@/core';
import { toData } from '@/document';
import type {
  DocumentId,
  DocumentLoadError,
  DocumentLoadIssue,
  DocumentMeta,
  DocumentReader,
  FeatureSchema,
} from '@/document';
import { formatVersionIssue, parseSnapshot } from './load';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import type { DocumentStore } from './store';

/** Contents of a .tinycad.json file: the current state, no history (spec 05, Q036). */
export interface TinycadFile {
  readonly format: 'tinycad.file';
  readonly formatVersion: 1;
  /** atSeq 0: the base snapshot of the document created by import. */
  readonly snapshot: DocumentSnapshot;
}

/** Pure: the current state of the document, without history. */
export function exportDocument(doc: DocumentReader): TinycadFile {
  return Object.freeze({
    format: 'tinycad.file',
    formatVersion: 1,
    snapshot: createSnapshot(doc, 0),
  });
}

/**
 * Checks the file and creates a new document from it: new id and createdAt, name from the file.
 * Issue paths are relative to the file ('snapshot.document.studio'). Nothing is stored on error.
 */
export async function importDocument(
  store: DocumentStore,
  raw: unknown,
  deps: { schemas: RegistryReader<FeatureSchema>; newId: DocumentId; now: number },
): Promise<Result<DocumentMeta, DocumentLoadError>> {
  const checked = checkFile(raw, deps.schemas);
  if (!checked.ok) return checked;

  const loaded = checked.value;
  const meta: DocumentMeta = { ...loaded.meta, id: deps.newId, createdAt: deps.now };
  // toData of the loaded document carries the migrated features; only meta is replaced.
  const snapshot: DocumentSnapshot = Object.freeze({
    format: 'tinycad.snapshot',
    formatVersion: 1,
    atSeq: 0,
    document: Object.freeze({ ...toData(loaded), meta }),
  });
  await store.createDocument(meta, snapshot);
  return ok(meta);
}

function checkFile(
  raw: unknown,
  schemas: RegistryReader<FeatureSchema>,
): Result<DocumentReader, DocumentLoadError> {
  if (!isRecord(raw)) return err({ issues: [{ path: '', message: 'Must be an object' }] });
  const issues: DocumentLoadIssue[] = [];
  if (raw.format !== 'tinycad.file') {
    issues.push({ path: 'format', message: "Must be 'tinycad.file'" });
  }
  const version = formatVersionIssue(raw.formatVersion);
  if (version !== undefined) issues.push(version);
  if (issues.length > 0) return err({ issues });

  const parsed = parseSnapshot(raw.snapshot, schemas, { max: 0, message: 'Must be 0' });
  if (!parsed.ok) {
    return err({
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path === '' ? 'snapshot' : `snapshot.${issue.path}`,
        message: issue.message,
      })),
    });
  }
  return ok(parsed.value.doc);
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
