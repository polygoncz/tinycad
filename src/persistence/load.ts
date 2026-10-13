import { assert, err, ok } from '@/core';
import type { Result } from '@/core';
import { fromData, toData } from '@/document';
import type {
  DocumentId,
  DocumentLoadError,
  DocumentLoadIssue,
  DocumentWriter,
  FeatureSchemaRegistry,
} from '@/document';
import { createOperationLog, parseLogEntry, replayLog } from '@/ops';
import type { LogEntry, OperationLoadError, OperationLog, OpHandlerRegistry } from '@/ops';
import type { DocumentStore } from './store';

export interface LoadedDocument {
  readonly doc: DocumentWriter;
  readonly log: OperationLog;
}

/** Why stored data could not be loaded (Q033). I/O failures of the store reject instead. */
export type LoadDocumentError =
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'snapshot';
      readonly which: 'latest' | 'base';
      readonly error: DocumentLoadError;
    }
  | { readonly kind: 'entry'; readonly seq: number; readonly error: OperationLoadError };

/**
 * Opens a stored document (spec 05): parses every log entry, loads the latest snapshot and
 * replays only the entries after it. With `verify` it also replays the whole log from the base
 * snapshot and throws when the two states differ – that breaks determinism, a programmer error.
 */
export async function loadDocument(
  store: DocumentStore,
  id: DocumentId,
  deps: { schemas: FeatureSchemaRegistry; handlers: OpHandlerRegistry; verify?: boolean },
): Promise<Result<LoadedDocument, LoadDocumentError>> {
  const { schemas, handlers } = deps;
  const stored = await store.load(id);
  if (stored === undefined) return err({ kind: 'not-found' });

  const entries = parseEntries(handlers, stored.entries);
  if (!entries.ok) return entries;

  const latest = loadSnapshot(stored.snapshot, id, entries.value.length, schemas, 'latest');
  if (!latest.ok) return latest;
  const { doc, atSeq } = latest.value;

  const replayed = replayEach(doc, handlers, entries.value.slice(atSeq));
  if (!replayed.ok) return replayed;

  const log = createOperationLog(entries.value);

  if (deps.verify === true) {
    const base = loadSnapshot(stored.base, id, entries.value.length, schemas, 'base');
    if (!base.ok) return base;
    // The base must be the state before entry 1, otherwise "replay everything" means nothing.
    if (base.value.atSeq !== 0) {
      return err(snapshotError('base', [{ path: 'atSeq', message: 'Must be 0' }]));
    }
    // A handler rejecting an entry is broken data here too, not broken determinism.
    const fromBase = replayEach(base.value.doc, handlers, entries.value);
    if (!fromBase.ok) return fromBase;
    assert(
      deepEqual(toData(base.value.doc), toData(doc)),
      `loadDocument: document '${id}' replayed from the base snapshot differs from ` +
        `snapshot ${String(atSeq)} + log (operations are not deterministic)`,
    );
  }

  return ok({ doc, log });
}

function parseEntries(
  handlers: OpHandlerRegistry,
  raw: readonly unknown[],
): Result<readonly LogEntry[], LoadDocumentError> {
  const entries: LogEntry[] = [];
  for (const [i, rawEntry] of raw.entries()) {
    const seq = i + 1;
    const parsed = parseLogEntry(handlers, rawEntry);
    if (!parsed.ok) return err({ kind: 'entry', seq, error: parsed.error });
    if (parsed.value.seq !== seq) {
      return err({
        kind: 'entry',
        seq,
        error: { path: 'seq', message: `Expected ${String(seq)}, got ${String(parsed.value.seq)}` },
      });
    }
    entries.push(parsed.value);
  }
  return ok(entries);
}

/** The snapshot envelope and fromData, plus the check that it belongs to the loaded document. */
function loadSnapshot(
  raw: unknown,
  id: DocumentId,
  lastSeq: number,
  schemas: FeatureSchemaRegistry,
  which: 'latest' | 'base',
): Result<{ doc: DocumentWriter; atSeq: number }, LoadDocumentError> {
  const parsed = parseSnapshot(raw, schemas, {
    max: lastSeq,
    message: `Must be a whole number in 0..${String(lastSeq)} (the stored entries)`,
  });
  if (!parsed.ok) return err({ kind: 'snapshot', which, error: parsed.error });
  if (parsed.value.doc.meta.id !== id) {
    return err(
      snapshotError(which, [
        { path: 'document.meta.id', message: `Must be the loaded document id '${id}'` },
      ]),
    );
  }
  return parsed;
}

/**
 * Envelope first, then fromData. Issue paths are relative to the snapshot ('document.meta.id').
 * Shared with importDocument; `atSeq` must be a whole number in 0..max, `message` says why.
 */
export function parseSnapshot(
  raw: unknown,
  schemas: FeatureSchemaRegistry,
  atSeqRule: { readonly max: number; readonly message: string },
): Result<{ doc: DocumentWriter; atSeq: number }, DocumentLoadError> {
  if (!isRecord(raw)) return err({ issues: [{ path: '', message: 'Must be an object' }] });
  const issues: DocumentLoadIssue[] = [];
  const { format, formatVersion, atSeq } = raw;
  if (format !== 'tinycad.snapshot') {
    issues.push({ path: 'format', message: "Must be 'tinycad.snapshot'" });
  }
  const version = formatVersionIssue(formatVersion);
  if (version !== undefined) issues.push(version);
  if (typeof atSeq !== 'number' || !Number.isInteger(atSeq) || atSeq < 0 || atSeq > atSeqRule.max) {
    issues.push({ path: 'atSeq', message: atSeqRule.message });
  }
  if (issues.length > 0 || typeof atSeq !== 'number') return err({ issues });

  const loaded = fromData(raw.document, schemas);
  if (!loaded.ok) {
    return err({
      issues: loaded.error.issues.map((issue) => ({
        path: issue.path === '' ? 'document' : `document.${issue.path}`,
        message: issue.message,
      })),
    });
  }
  return ok({ doc: loaded.value, atSeq });
}

/** Format version 1 is the only known one; a higher one asks for an app update. */
export function formatVersionIssue(formatVersion: unknown): DocumentLoadIssue | undefined {
  if (typeof formatVersion === 'number' && Number.isInteger(formatVersion) && formatVersion > 1) {
    return {
      path: 'formatVersion',
      message: `Version ${String(formatVersion)} is newer than the known 1; update the app`,
    };
  }
  return formatVersion === 1 ? undefined : { path: 'formatVersion', message: 'Must be 1' };
}

/** One entry at a time, so a failing handler names the entry. Broken log = broken data. */
function replayEach(
  doc: DocumentWriter,
  handlers: OpHandlerRegistry,
  entries: readonly LogEntry[],
): Result<void, LoadDocumentError> {
  for (const entry of entries) {
    try {
      replayLog(doc, handlers, [entry]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: 'entry', seq: entry.seq, error: { path: 'op', message } });
    }
  }
  return ok(undefined);
}

function snapshotError(
  which: 'latest' | 'base',
  issues: readonly DocumentLoadIssue[],
): LoadDocumentError {
  return { kind: 'snapshot', which, error: { issues } };
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Structural equality of plain JSON data. Not JSON.stringify: key order differs between
 * a feature built by fromData and one inserted by feature.add, the data are still equal.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, i) => deepEqual(item, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
  );
}
