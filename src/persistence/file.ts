import { err, ok } from '@/core';
import type { RegistryReader, Result } from '@/core';
import { toData } from '@/document';
import type {
  DocumentData,
  DocumentId,
  DocumentLoadError,
  DocumentLoadIssue,
  DocumentMeta,
  DocumentReader,
  DocumentWriter,
  FeatureSchema,
} from '@/document';
import { rebuildUndoStacks } from '@/ops';
import type { LogEntry, OpHandlerRegistry } from '@/ops';
import {
  deepEqual,
  loadBaseSnapshot,
  loadSnapshot,
  parseEntries,
  parseSnapshot,
  replayEach,
} from './load';
import type { EntryError, LoadDocumentError } from './load';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import type { DocumentStore } from './store';

/** Contents of a .tinycad.json file (spec 05, Q036): the current state, optionally the history. */
export interface TinycadFile {
  readonly format: 'tinycad.file';
  /** M4 wrote 1 (no history); import reads both. */
  readonly formatVersion: 2;
  /** The state of the document; atSeq = history.entries.length, 0 without history. */
  readonly snapshot: DocumentSnapshot;
  readonly history?: TinycadHistory;
}

/** The operation log of the document and the state it starts from (M15). */
export interface TinycadHistory {
  /** atSeq 0: the state before entry 1. */
  readonly base: DocumentSnapshot;
  /** The whole log, seq 1..n without gaps. */
  readonly entries: readonly LogEntry[];
}

/** Pure: the current state of the document, without history. */
export function exportDocument(doc: DocumentReader): TinycadFile {
  return Object.freeze({
    format: 'tinycad.file',
    formatVersion: 2,
    snapshot: createSnapshot(doc, 0),
  });
}

/**
 * A stored document with its history: the state as loadDocument opens it (without verify), the
 * base snapshot checked as with verify and the whole log. Features and operations come out in
 * their current versions (migrated by fromData and parseLogEntry).
 */
export async function exportStoredDocument(
  store: DocumentStore,
  id: DocumentId,
  deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry },
): Promise<Result<TinycadFile, LoadDocumentError>> {
  const { schemas, handlers } = deps;
  const stored = await store.load(id);
  if (stored === undefined) return err({ kind: 'not-found' });

  const entries = parseEntries(handlers, stored.entries);
  if (!entries.ok) return entries;
  const n = entries.value.length;

  const latest = loadSnapshot(stored.snapshot, id, n, schemas, 'latest');
  if (!latest.ok) return latest;
  const replayed = replayEach(latest.value.doc, handlers, entries.value.slice(latest.value.atSeq));
  if (!replayed.ok) return replayed;

  const base = loadBaseSnapshot(stored.base, id, n, schemas);
  if (!base.ok) return base;

  return ok(
    Object.freeze({
      format: 'tinycad.file',
      formatVersion: 2,
      snapshot: createSnapshot(latest.value.doc, n),
      history: Object.freeze({
        base: createSnapshot(base.value.doc, 0),
        entries: Object.freeze(entries.value.map((entry) => Object.freeze(entry))),
      }),
    }),
  );
}

/**
 * Checks the file and creates a new document from it: new id and createdAt, name from the file,
 * the history too when the file has one. Issue paths are relative to the file
 * ('snapshot.document.studio', 'history.entries[3].op'). Nothing is stored on error. A store
 * failure rejects; when it happens after createDocument, the new document is deleted again.
 */
export async function importDocument(
  store: DocumentStore,
  raw: unknown,
  deps: {
    schemas: RegistryReader<FeatureSchema>;
    handlers: OpHandlerRegistry;
    newId: DocumentId;
    now: number;
  },
): Promise<Result<DocumentMeta, DocumentLoadError>> {
  const checked = checkFile(raw, deps.schemas, deps.handlers);
  if (!checked.ok) return checked;

  const { state, base, entries } = checked.value;
  const meta: DocumentMeta = { ...state.meta, id: deps.newId, createdAt: deps.now };
  await store.createDocument(meta, storedSnapshot(base, meta, 0));
  if (entries.length === 0) return ok(meta);
  try {
    await store.appendEntries(meta.id, entries);
    await store.saveSnapshot(meta.id, storedSnapshot(state, meta, entries.length));
  } catch (e) {
    // Do not leave a half-imported document in the list; the original error matters more.
    await store.deleteDocument(meta.id).catch(() => undefined);
    throw e;
  }
  return ok(meta);
}

/** toData of a loaded document carries the migrated features; only meta is replaced. */
function storedSnapshot(data: DocumentData, meta: DocumentMeta, atSeq: number): DocumentSnapshot {
  const document: DocumentData = Object.freeze({ ...data, meta });
  return Object.freeze({ format: 'tinycad.snapshot', formatVersion: 1, atSeq, document });
}

/** A checked file: the state, the base it starts from (the state itself without history). */
interface CheckedFile {
  readonly state: DocumentData;
  readonly base: DocumentData;
  readonly entries: readonly LogEntry[];
}

/** Groups in order, the first broken one ends the check: envelope, snapshot, base, entries, replay. */
function checkFile(
  raw: unknown,
  schemas: RegistryReader<FeatureSchema>,
  handlers: OpHandlerRegistry,
): Result<CheckedFile, DocumentLoadError> {
  if (!isRecord(raw)) return issue('', 'Must be an object');
  const issues: DocumentLoadIssue[] = [];
  if (raw.format !== 'tinycad.file') {
    issues.push({ path: 'format', message: "Must be 'tinycad.file'" });
  }
  const version = fileVersionIssue(raw.formatVersion);
  if (version !== undefined) issues.push(version);
  // Only version 2 knows history; a version 1 file is read exactly as in M4.
  const history = raw.formatVersion === 2 ? raw.history : undefined;
  if (history !== undefined && !isRecord(history)) {
    issues.push({ path: 'history', message: 'Must be an object' });
  }
  if (issues.length > 0) return err({ issues });

  if (history === undefined || !isRecord(history)) {
    const parsed = parseSnapshot(raw.snapshot, schemas, { max: 0, message: 'Must be 0' });
    if (!parsed.ok) return err(under('snapshot', parsed.error));
    const data = toData(parsed.value.doc);
    return ok({ state: data, base: data, entries: [] });
  }
  return checkHistory(raw.snapshot, history, schemas, handlers);
}

function checkHistory(
  rawSnapshot: unknown,
  history: Readonly<Record<string, unknown>>,
  schemas: RegistryReader<FeatureSchema>,
  handlers: OpHandlerRegistry,
): Result<CheckedFile, DocumentLoadError> {
  // The exact atSeq is checked against the entries below; here only its shape.
  const snapshot = parseSnapshot(rawSnapshot, schemas, {
    max: Number.MAX_SAFE_INTEGER,
    message: 'Must be a whole number >= 0',
  });
  if (!snapshot.ok) return err(under('snapshot', snapshot.error));

  const base = parseSnapshot(history.base, schemas, { max: 0, message: 'Must be 0' });
  if (!base.ok) return err(under('history.base', base.error));

  const rawEntries = history.entries;
  if (!Array.isArray(rawEntries)) return issue('history.entries', 'Must be an array');
  // Array.isArray narrows to any[]; the entries are data from outside.
  const entries = parseEntries(handlers, rawEntries as readonly unknown[]);
  if (!entries.ok) return err(entryIssue(entries.error, true));
  const n = entries.value.length;
  if (snapshot.value.atSeq !== n) {
    return issue('snapshot.atSeq', `Must be ${String(n)} (the history entries)`);
  }

  // toData does not copy and the data are immutable: this stays the base after the replay.
  const baseData = toData(base.value.doc);
  const replayed: DocumentWriter = base.value.doc;
  const applied = replayEach(replayed, handlers, entries.value);
  if (!applied.ok) return err(entryIssue(applied.error, false));
  try {
    rebuildUndoStacks(entries.value);
  } catch (e) {
    return issue('history.entries', e instanceof Error ? e.message : String(e));
  }
  // A file from outside may have been edited: a mismatch is broken data, not broken determinism.
  const state = toData(snapshot.value.doc);
  if (!deepEqual(toData(replayed).studio, state.studio)) {
    return issue('history', 'Replayed history does not match the snapshot');
  }
  return ok({ state, base: baseData, entries: entries.value });
}

/** Format version 2 is the current one, 1 is M4 without history; higher asks for an app update. */
function fileVersionIssue(formatVersion: unknown): DocumentLoadIssue | undefined {
  if (formatVersion === 1 || formatVersion === 2) return undefined;
  if (typeof formatVersion === 'number' && Number.isInteger(formatVersion) && formatVersion > 2) {
    return {
      path: 'formatVersion',
      message: `Version ${String(formatVersion)} is newer than the known 2; update the app`,
    };
  }
  return { path: 'formatVersion', message: 'Must be 1 or 2' };
}

/**
 * An entry error as a file issue. Parse errors keep their path inside the entry
 * ('history.entries[3].op.featureId'); a handler failing during replay names the entry only.
 */
function entryIssue(error: EntryError, withPath: boolean): DocumentLoadError {
  const entry = `history.entries[${String(error.seq - 1)}]`;
  const path = withPath && error.error.path !== '' ? `${entry}.${error.error.path}` : entry;
  return { issues: [{ path, message: error.error.message }] };
}

function under(prefix: string, error: DocumentLoadError): DocumentLoadError {
  return {
    issues: error.issues.map((i) => ({
      path: i.path === '' ? prefix : `${prefix}.${i.path}`,
      message: i.message,
    })),
  };
}

function issue(path: string, message: string): Result<never, DocumentLoadError> {
  return err({ issues: [{ path, message }] });
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
