// The contract of RemoteSession (M46 task 1): its options, changes, outcomes and the interface.
// Apart from session.ts so the parts of the session (ChangeQueue, WatchStream) use the types
// without an import cycle; session.ts re-exports them.

import type { Transport } from '@connectrpc/connect';
import type { Disposable, Observable, Subscribable } from '@/core';
import type { DocumentId, FeatureId, FeatureSchema } from '@/document';
import type { MeshQuality } from '@/kernel';
import type { Operation } from '@/ops';
import type { RemoteError } from './errors';
import type { HistoryData, LogEntryData, ReadModelData } from './read-model';

/** The state of the connection to the core, for KernelUiState and PersistenceStatus (N69). */
export type ConnectionState = 'connecting' | 'online' | 'retrying' | 'offline';

/** What the client says about itself in every request that returns a read model. */
export interface ReadOptions {
  /** content_version of every mesh the client holds (Q100). */
  readonly knownMeshes: readonly string[];
  /** The feature of the open feature dialog (ADR 0025); null = none. */
  readonly inputOf: FeatureId | null;
}

/** Where the tab keeps its session_id across a reload (sessionStorage, N70). */
export interface SessionResumeStore {
  load(): string | null;
  save(id: string | null): void;
}

/** Timers of the session: the waits between attempts and the watch of the stream. */
export interface Timers {
  schedule(fn: () => void, ms: number): Disposable;
}

/** Repeating a retryable call (spec 14 "Chyby"): `attempts` in all, waiting baseDelayMs × 2ⁿ. */
export interface RetryPolicy {
  readonly attempts: number;
  readonly baseDelayMs: number;
}

/** The default RetryPolicy: 5 attempts, 200 ms × 2ⁿ. */
export const DEFAULT_RETRY: RetryPolicy = Object.freeze({ attempts: 5, baseDelayMs: 200 });

export interface RemoteSessionOptions {
  readonly transport: Transport;
  readonly docId: DocumentId;
  /** Tessellation of every mesh of the session; absent = the server default. */
  readonly meshQuality?: MeshQuality;
  /** A new UUID v4 for every request that changes something. */
  readonly newOperationId: () => string;
  /** Read when each request is SENT (not when it is queued). */
  readonly readOptions: () => ReadOptions;
  readonly resume: SessionResumeStore;
  readonly timers: Timers;
  /** Default DEFAULT_RETRY. */
  readonly retry?: RetryPolicy;
}

/** One change of the document, as the RPCs of spec 14 "Změny dokumentu". */
export type ChangeRequest =
  | { readonly kind: 'dispatch'; readonly op: Operation; readonly label?: string }
  | { readonly kind: 'begin'; readonly label: string }
  | { readonly kind: 'apply'; readonly op: Operation }
  | { readonly kind: 'applyTransient'; readonly op: Operation }
  | { readonly kind: 'commit' }
  | { readonly kind: 'abort' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

/** The result of a change: never a rejection for an error of the server. */
export type ChangeOutcome =
  | {
      readonly ok: true;
      /** The log entry the change wrote; null for a step of a transaction or an empty commit. */
      readonly entry: LogEntryData | null;
      readonly readModel: ReadModelData;
    }
  | { readonly ok: false; readonly error: RemoteError };

export type RemoteSessionEvents = {
  /** The open transaction ended on the server (a new session after a restart, spec 14). */
  lost: { readonly what: 'transaction' };
};

/** A session of the core over one open document (spec 14 "Sezení"). */
export interface RemoteSession {
  /** All feature types the core knows (Q098), as schemas (featureSchemaOf). */
  readonly featureTypes: readonly FeatureSchema[];
  /** The last read model: of an answer, of GetReadModel after an event, of a new session. */
  readonly readModel: Observable<ReadModelData>;
  readonly connection: Observable<ConnectionState>;
  /** Changes queued and in flight. */
  readonly pending: Observable<number>;
  readonly events: Subscribable<RemoteSessionEvents>;
  /** Queues a change; resolves with its outcome, rejects only after dispose. */
  change(request: ChangeRequest): Promise<ChangeOutcome>;
  /** GetReadModel. */
  refresh(): Promise<void>;
  /** The log from `fromSeq` on and the undo stacks (GetHistory). */
  history(fromSeq: number): Promise<HistoryData>;
  /** STEP of the visible bodies of the final state. */
  exportStep(): Promise<{ readonly content: Uint8Array; readonly fileName: string }>;
  /** CloseSession with keepalive. */
  close(): Promise<void>;
  dispose(): void;
}
