// A session of the core over SessionService (spec 14 "Sezení", "Změny dokumentu", "Události";
// Q097, Q102, N70): the queue of changes with one in flight, repeating with the same operation_id,
// a new session after SESSION_NOT_FOUND, the WatchSession stream and the last read model.
// The parts: ChangeQueue (one change in flight, recovery after a new session), WatchStream (the
// events), Retrier (repeating retryable calls); RemoteSessionImpl wires them over one client.

import { createClient } from '@connectrpc/connect';
import type { Client } from '@connectrpc/connect';
import { Emitter, ObservableValue } from '@/core';
import type { Disposable, Observable, Subscribable } from '@/core';
import type { FeatureSchema } from '@/document';
import type { MeshQuality } from '@/kernel';
import { SessionService } from '@/protocol';
import type {
  ChangeResult,
  OpenSessionResponse,
  ReadModel,
  ReadModelOptions,
  SessionEvent,
} from '@/protocol';
import { ChangeQueue } from './change-queue';
import type { ChangeSent, QueuedChange } from './change-queue';
import { decoding, isRetryable, RemoteError, toRemoteError } from './errors';
import { featureSchemaOf } from './feature-types';
import { operationToProto } from './operations';
import { decodeHistory, decodeLogEntry, decodeReadModel } from './read-model';
import type { HistoryData, ReadModelData } from './read-model';
import { DEFAULT_RETRY } from './session-contract';
import type {
  ChangeOutcome,
  ChangeRequest,
  ConnectionState,
  ReadOptions,
  RemoteSession,
  RemoteSessionEvents,
  RemoteSessionOptions,
  RetryPolicy,
  Timers,
} from './session-contract';
import { KEEPALIVE_HEADER } from './transport';
import { WatchStream } from './watch';

export { DEFAULT_RETRY } from './session-contract';
export type {
  ChangeOutcome,
  ChangeRequest,
  ConnectionState,
  ReadOptions,
  RemoteSession,
  RemoteSessionEvents,
  RemoteSessionOptions,
  RetryPolicy,
  SessionResumeStore,
  Timers,
} from './session-contract';

/**
 * Opens a session of the document (OpenSession with resume_session_id, repeated as any retryable
 * call) and its stream. Rejects with RemoteError when the core does not open it.
 */
export async function openRemoteSession(options: RemoteSessionOptions): Promise<RemoteSession> {
  const client = createClient(SessionService, options.transport);
  const retrier = new Retrier(options.timers, options.retry ?? DEFAULT_RETRY);
  const opened = await retrier.run(() =>
    client.openSession({
      documentId: options.docId,
      ...meshQualityOf(options.meshQuality),
      read: readOptionsOf(options.readOptions()),
      resumeSessionId: options.resume.load() ?? '',
    }),
  );
  return new RemoteSessionImpl(options, client, retrier, opened);
}

class RemoteSessionImpl implements RemoteSession {
  readonly featureTypes: readonly FeatureSchema[];
  private readonly readModelValue: ObservableValue<ReadModelData>;
  private readonly connectionValue = new ObservableValue<ConnectionState>('online');
  private readonly pendingValue = new ObservableValue(0);
  private readonly emitter = new Emitter<RemoteSessionEvents>();
  private readonly queue: ChangeQueue;
  private readonly watch: WatchStream;
  /** Aborts every call in flight on dispose. */
  private readonly abort = new AbortController();
  private sessionId = '';
  /** Counts the sessions this object opened; tells a stale SESSION_NOT_FOUND from a fresh one. */
  private epoch = 0;
  private renewing: Promise<void> | null = null;
  /** The epoch `lost` was reported in (at most once per session). */
  private lostIn = -1;
  private readonly options: RemoteSessionOptions;
  private readonly client: Client<typeof SessionService>;
  private readonly retrier: Retrier;

  constructor(
    options: RemoteSessionOptions,
    client: Client<typeof SessionService>,
    retrier: Retrier,
    opened: OpenSessionResponse,
  ) {
    this.options = options;
    this.client = client;
    this.retrier = retrier;
    this.featureTypes = Object.freeze(opened.featureTypes.map(featureSchemaOf));
    this.readModelValue = new ObservableValue(decodeAnswer(opened.readModel));
    retrier.onState = (state) => {
      this.connectionValue.set(state);
    };
    this.queue = new ChangeQueue({
      send: (change) => this.send(change),
      renewSession: (failedEpoch, transactionLost) => this.renew(failedEpoch, transactionLost),
      newOperationId: options.newOperationId,
      onPending: (count) => {
        this.pendingValue.set(count);
      },
    });
    this.watch = new WatchStream({
      client,
      timers: options.timers,
      retry: options.retry ?? DEFAULT_RETRY,
      onEvent: (event) => {
        this.onEvent(event);
      },
      onSessionNotFound: (epoch) => {
        this.renew(epoch, false).catch(() => undefined); // the next call tries again
      },
    });
    this.adopt(opened);
  }

  get readModel(): Observable<ReadModelData> {
    return this.readModelValue.asObservable();
  }

  get connection(): Observable<ConnectionState> {
    return this.connectionValue.asObservable();
  }

  get pending(): Observable<number> {
    return this.pendingValue.asObservable();
  }

  get events(): Subscribable<RemoteSessionEvents> {
    return this.emitter.asSubscribable();
  }

  change(request: ChangeRequest): Promise<ChangeOutcome> {
    return this.queue.enqueue(request);
  }

  /**
   * GetReadModel runs beside the queue of changes, so its answer may come after the answer of a
   * change the server handled later: a read model of an older generation than the one published
   * by then is dropped (it would put back the document without that change). The same generation
   * is taken (the same document, maybe another input_of).
   */
  async refresh(): Promise<void> {
    const res = await this.call((sessionId) =>
      this.client.getReadModel(
        { sessionId, read: readOptionsOf(this.options.readOptions()) },
        this.callOptions(),
      ),
    );
    const model = decodeAnswer(res.readModel);
    if (model.regen.generation < this.readModelValue.get().regen.generation) return;
    this.readModelValue.set(model);
  }

  async history(fromSeq: number): Promise<HistoryData> {
    const res = await this.call((sessionId) =>
      this.client.getHistory({ sessionId, fromSeq: BigInt(fromSeq) }, this.callOptions()),
    );
    return decodeHistory(res);
  }

  async exportStep(): Promise<{ readonly content: Uint8Array; readonly fileName: string }> {
    const res = await this.call((sessionId) =>
      this.client.exportStep({ sessionId }, this.callOptions()),
    );
    return Object.freeze({ content: res.content, fileName: res.fileName });
  }

  /**
   * Stops the stream (a closed session must not renew itself) and sends CloseSession once, with
   * keepalive so it survives the unload of the page (N70). The resume store keeps the id: a
   * reload resumes it if the close got lost, else the server opens a new session.
   */
  async close(): Promise<void> {
    this.watch.dispose();
    try {
      await this.client.closeSession(
        { sessionId: this.sessionId },
        { headers: { [KEEPALIVE_HEADER]: '1' } },
      );
    } catch (e) {
      throw toRemoteError(e);
    }
  }

  dispose(): void {
    this.watch.dispose();
    this.queue.dispose();
    this.retrier.dispose();
    this.abort.abort();
  }

  // ---- internal ------------------------------------------------------------------------------

  /** Sends one change to the current session; a failure of the call is the outcome. */
  private async send(change: QueuedChange): Promise<ChangeSent> {
    const { sessionId, epoch } = this;
    try {
      const result = await this.retrier.run(() => this.rpcOf(change, sessionId));
      const readModel = decodeAnswer(result?.readModel);
      const entry = result?.entry === undefined ? null : decodeLogEntry(result.entry);
      this.readModelValue.set(readModel);
      return { outcome: { ok: true, entry, readModel }, epoch };
    } catch (e) {
      return { outcome: { ok: false, error: toRemoteError(e) }, epoch };
    }
  }

  /** The RPC of a change; the read options are read now, at every attempt. */
  private async rpcOf(change: QueuedChange, sessionId: string): Promise<ChangeResult | undefined> {
    const { request, operationId } = change;
    const base = { sessionId, operationId, read: readOptionsOf(this.options.readOptions()) };
    const options = this.callOptions();
    switch (request.kind) {
      case 'dispatch': {
        const op = operationToProto(request.op);
        return (await this.client.dispatch({ ...base, op, label: request.label ?? '' }, options))
          .result;
      }
      case 'begin':
        return (await this.client.beginTransaction({ ...base, label: request.label }, options))
          .result;
      case 'apply':
        return (await this.client.apply({ ...base, op: operationToProto(request.op) }, options))
          .result;
      case 'applyTransient': {
        const op = operationToProto(request.op);
        return (await this.client.applyTransient({ ...base, op }, options)).result;
      }
      case 'commit':
        return (await this.client.commit(base, options)).result;
      case 'abort':
        return (await this.client.abort(base, options)).result;
      case 'undo':
        return (await this.client.undo(base, options)).result;
      case 'redo':
        return (await this.client.redo(base, options)).result;
    }
  }

  /** A call of the current session, repeated when retryable and once more in a new session. */
  private async call<T>(rpc: (sessionId: string) => Promise<T>): Promise<T> {
    const { sessionId, epoch } = this;
    try {
      return await this.retrier.run(() => rpc(sessionId));
    } catch (e) {
      const error = toRemoteError(e);
      if (error.reason !== 'SESSION_NOT_FOUND') throw error;
      await this.renew(epoch, false);
      return this.retrier.run(() => rpc(this.sessionId));
    }
  }

  /**
   * A new session after SESSION_NOT_FOUND in the session `failedEpoch`: OpenSession without
   * resume, once however many ask (a stale epoch joins the renewal or finds it done). `lost` when
   * this session had a transaction open or `transactionLost` says steps of one died.
   */
  private async renew(failedEpoch: number, transactionLost: boolean): Promise<void> {
    if (failedEpoch === this.epoch && this.renewing === null) {
      const { session } = this.readModelValue.get();
      const transactionOpen = session.writable && session.transactionLabel !== null;
      this.renewing = this.openNew(transactionOpen).finally(() => {
        this.renewing = null;
      });
    }
    if (this.renewing !== null) await this.renewing;
    if (transactionLost) this.reportLost();
  }

  private async openNew(transactionOpen: boolean): Promise<void> {
    this.connectionValue.set('connecting');
    const opened = await this.retrier.run(() =>
      this.client.openSession(
        {
          documentId: this.options.docId,
          ...meshQualityOf(this.options.meshQuality),
          read: readOptionsOf(this.options.readOptions()),
        },
        this.callOptions(),
      ),
    );
    this.readModelValue.set(decodeAnswer(opened.readModel));
    this.adopt(opened);
    if (transactionOpen) this.reportLost();
  }

  /** Takes an opened session: its id (kept for a reload), a new epoch and its stream. */
  private adopt(opened: OpenSessionResponse): void {
    this.sessionId = opened.sessionId;
    this.epoch += 1;
    this.options.resume.save(opened.sessionId);
    this.watch.restart(opened.sessionId, opened.eventSeq, this.epoch);
  }

  private reportLost(): void {
    if (this.lostIn === this.epoch) return;
    this.lostIn = this.epoch;
    this.emitter.emit('lost', { what: 'transaction' });
  }

  /** A change of another session, or events the server no longer has → read the model again. */
  private onEvent(event: SessionEvent): void {
    const { event: what } = event;
    const foreign = what.case === 'changed' && what.value.bySessionId !== this.sessionId;
    if (foreign || what.case === 'resync') {
      this.refresh().catch(() => undefined); // the state of the connection shows the failure
    }
  }

  private callOptions(): { readonly signal: AbortSignal } {
    return { signal: this.abort.signal };
  }
}

/**
 * Repeats a retryable call (spec 14 "Chyby"): the same request (so the same operation_id) after
 * baseDelayMs × 2ⁿ, `attempts` in all; reports the state of the connection on the way. Every call
 * starts from the first attempt (the connection may be back).
 */
class Retrier {
  onState: (state: ConnectionState) => void = () => undefined;
  private readonly waits = new Set<{ readonly timer: Disposable; readonly fail: () => void }>();
  private disposed = false;
  private readonly timers: Timers;
  private readonly policy: RetryPolicy;

  constructor(timers: Timers, policy: RetryPolicy) {
    this.timers = timers;
    this.policy = policy;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    for (let n = 0; ; n++) {
      try {
        const result = await call();
        this.onState('online');
        return result;
      } catch (e) {
        const error = toRemoteError(e);
        if (this.disposed) throw error;
        if (!isRetryable(error)) {
          this.onState('online'); // the core answered
          throw error;
        }
        if (n + 1 >= this.policy.attempts) {
          this.onState('offline');
          throw error;
        }
        this.onState('retrying');
        await this.wait(this.policy.baseDelayMs * 2 ** n);
      }
    }
  }

  /** Ends every wait with a rejection; no call starts any more. */
  dispose(): void {
    this.disposed = true;
    for (const w of [...this.waits]) {
      w.timer.dispose();
      w.fail();
    }
    this.waits.clear();
  }

  private wait(ms: number): Promise<void> {
    if (this.disposed) return Promise.reject(disposedError());
    return new Promise<void>((resolve, reject) => {
      const entry = {
        timer: this.timers.schedule(() => {
          this.waits.delete(entry);
          resolve();
        }, ms),
        fail: () => {
          reject(disposedError());
        },
      };
      this.waits.add(entry);
    });
  }
}

function readOptionsOf(read: ReadOptions): Omit<ReadModelOptions, '$typeName'> {
  return { knownMeshes: [...read.knownMeshes], inputOf: read.inputOf ?? '' };
}

function meshQualityOf(quality: MeshQuality | undefined) {
  return quality === undefined
    ? {}
    : {
        meshQuality: {
          linearDeflection: quality.linearDeflection,
          angularDeflection: quality.angularDeflection,
        },
      };
}

/** The read model of an answer; a missing one is a broken answer. */
function decodeAnswer(readModel: ReadModel | undefined): ReadModelData {
  if (readModel !== undefined) return decodeReadModel(readModel);
  return decoding('answer', () => {
    throw new Error('read_model is missing');
  });
}

function disposedError(): RemoteError {
  return new RemoteError({ code: 'CANCELLED', message: 'RemoteSession: disposed' });
}
