// The queue of changes of one session (spec 14 "Změny dokumentu", M46 task 2): at most one change
// in flight, the rest wait in order. Every change gets its operation_id when it is queued and keeps
// it for every repeat, also in a new session (durable idempotence, spec 14 "Idempotence"). A queued
// `apply` of feature.setParams is replaced by a newer one of the same feature (a drag: the last
// value wins, as the transaction merges it anyway); nothing else coalesces.
//
// After SESSION_NOT_FOUND (a restart of the server, an idle timeout) the change that got it and
// every queued one are recovered once a new session is open: durable changes (dispatch, undo,
// redo) go again with the same operation_id, the steps of a transaction and its end fail with
// NO_TRANSACTION (the transaction died with the old session; the session reports `lost`).

import { RemoteError, toRemoteError } from './errors';
import type { ChangeOutcome, ChangeRequest } from './session-contract';

/** A change as it travels: the request and its operation_id, fixed when it was queued. */
export interface QueuedChange {
  readonly request: ChangeRequest;
  readonly operationId: string;
}

/** The answer of one change and the session it went to (a counter of sessions, not the id). */
export interface ChangeSent {
  readonly outcome: ChangeOutcome;
  readonly epoch: number;
}

export interface ChangeQueueDeps {
  /** Sends one change, repeating retryable failures; never rejects for a failure of the call. */
  send(change: QueuedChange): Promise<ChangeSent>;
  /**
   * Opens a new session after SESSION_NOT_FOUND in the session `failedEpoch` (once, however many
   * ask); `transactionLost` = steps of a transaction died with it. Rejects when none opens.
   */
  renewSession(failedEpoch: number, transactionLost: boolean): Promise<void>;
  newOperationId(): string;
  /** The number of changes queued and in flight changed. */
  onPending(count: number): void;
}

interface Caller {
  readonly resolve: (outcome: ChangeOutcome) => void;
  readonly reject: (reason: unknown) => void;
}

/** A queued change with everybody waiting for its outcome (more than one after a replacement). */
interface Entry {
  readonly change: QueuedChange;
  readonly callers: readonly Caller[];
}

export class ChangeQueue {
  private queue: readonly Entry[] = [];
  private inFlight: Entry | null = null;
  /** The changes waiting for a new session after SESSION_NOT_FOUND. */
  private held: readonly Entry[] = [];
  private running = false;
  private disposed = false;
  private readonly deps: ChangeQueueDeps;

  constructor(deps: ChangeQueueDeps) {
    this.deps = deps;
  }

  get pending(): number {
    return this.queue.length + this.held.length + (this.inFlight === null ? 0 : 1);
  }

  /** Queues a change; resolves with its outcome, rejects only after dispose. */
  enqueue(request: ChangeRequest): Promise<ChangeOutcome> {
    if (this.disposed) return Promise.reject(disposedError());
    return new Promise<ChangeOutcome>((resolve, reject) => {
      const caller: Caller = { resolve, reject };
      const change: QueuedChange = { request, operationId: this.deps.newOperationId() };
      const last = this.queue.at(-1);
      if (last !== undefined && replaces(change.request, last.change.request)) {
        this.queue = [...this.queue.slice(0, -1), { change, callers: [...last.callers, caller] }];
        return;
      }
      this.queue = [...this.queue, { change, callers: [caller] }];
      this.changedPending();
      if (!this.running) void this.drain();
    });
  }

  /** Rejects every waiting change; the queue sends nothing more. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const all = [...(this.inFlight === null ? [] : [this.inFlight]), ...this.held, ...this.queue];
    this.inFlight = null;
    this.held = [];
    this.queue = [];
    for (const entry of all) for (const c of entry.callers) c.reject(disposedError());
  }

  private async drain(): Promise<void> {
    this.running = true;
    for (;;) {
      const [head, ...rest] = this.queue;
      if (head === undefined) break;
      this.queue = rest;
      this.inFlight = head;
      const sent = await this.deps.send(head.change);
      if (this.disposed) break;
      this.inFlight = null;
      if (!sent.outcome.ok && sent.outcome.error.reason === 'SESSION_NOT_FOUND') {
        await this.recover(head, sent.epoch);
      } else {
        settle(head, sent.outcome);
      }
      this.changedPending();
    }
    this.running = false;
  }

  /** SESSION_NOT_FOUND of `head`: a new session, then durable changes again, the rest fail. */
  private async recover(head: Entry, failedEpoch: number): Promise<void> {
    const affected = [head, ...this.queue];
    this.queue = [];
    this.held = affected;
    const transactionLost = affected.some((e) => !isDurable(e.change.request));
    try {
      await this.deps.renewSession(failedEpoch, transactionLost);
    } catch (e) {
      if (this.disposed) return;
      this.held = [];
      const outcome: ChangeOutcome = { ok: false, error: toRemoteError(e) };
      for (const entry of affected) settle(entry, outcome);
      return;
    }
    if (this.disposed) return;
    this.held = [];
    const lost: ChangeOutcome = { ok: false, error: noTransaction() };
    for (const entry of affected) if (!isDurable(entry.change.request)) settle(entry, lost);
    this.queue = [...affected.filter((e) => isDurable(e.change.request)), ...this.queue];
  }

  private changedPending(): void {
    this.deps.onPending(this.pending);
  }
}

/** A change written to the log at once, idempotent across sessions (spec 14 "Idempotence"). */
function isDurable(request: ChangeRequest): boolean {
  return request.kind === 'dispatch' || request.kind === 'undo' || request.kind === 'redo';
}

/** `next` replaces the queued `queued`: both apply feature.setParams of the same feature. */
function replaces(next: ChangeRequest, queued: ChangeRequest): boolean {
  if (next.kind !== 'apply' || queued.kind !== 'apply') return false;
  const a = setParamsTarget(next);
  return a !== null && a === setParamsTarget(queued);
}

function setParamsTarget(request: ChangeRequest & { readonly kind: 'apply' }): string | null {
  const op: { readonly type: string; readonly featureId?: unknown } = request.op;
  return op.type === 'feature.setParams' && typeof op.featureId === 'string' ? op.featureId : null;
}

function settle(entry: Entry, outcome: ChangeOutcome): void {
  for (const c of entry.callers) c.resolve(outcome);
}

function noTransaction(): RemoteError {
  return new RemoteError({
    code: 'FAILED_PRECONDITION',
    reason: 'NO_TRANSACTION',
    message: 'The transaction ended with its session (SESSION_NOT_FOUND)',
  });
}

function disposedError(): Error {
  // The same shape as the disposal of the session (session.ts): a RemoteError CANCELLED, so the
  // dispatcher tells an expected cancellation from a bug of the program (N176).
  return new RemoteError({ code: 'CANCELLED', message: 'RemoteSession: disposed' });
}
