// The WatchSession stream of one session (spec 14 "Události: WatchSession", M46 task 2): kept open
// for the whole session. When it ends or fails it connects again after the last event it got
// (after_seq), waiting as a retry does, without a limit; silence longer than two heartbeats
// (2 × 30 s) counts as a dead connection and it connects again. SESSION_NOT_FOUND stops it until
// the session renews and restarts it.

import type { Client } from '@connectrpc/connect';
import type { Disposable } from '@/core';
import type { SessionEvent, SessionService } from '@/protocol';
import { toRemoteError } from './errors';
import type { RetryPolicy, Timers } from './session-contract';

/** The server sends a heartbeat after 30 s of silence; two missed ones = a dead connection. */
export const SILENCE_MS = 2 * 30_000;

export interface WatchStreamDeps {
  readonly client: Client<typeof SessionService>;
  readonly timers: Timers;
  readonly retry: RetryPolicy;
  /** Every event of the stream, heartbeats included, in order. */
  onEvent(event: SessionEvent): void;
  /** The stream of the session `epoch` got SESSION_NOT_FOUND; the stream waits for restart. */
  onSessionNotFound(epoch: number): void;
}

/** What the stream watches: a session (with its counter, see ChangeSent) after an event seq. */
interface Target {
  readonly sessionId: string;
  readonly epoch: number;
}

export class WatchStream {
  private target: Target | null = null;
  private afterSeq = 0n;
  private running = false;
  private disposed = false;
  /** Aborts the open call (a restart, a silence, dispose). */
  private abort: AbortController | null = null;
  /** Ends the wait before the next attempt at once (a restart, dispose). */
  private wake: (() => void) | null = null;
  private failures = 0;
  private readonly deps: WatchStreamDeps;

  constructor(deps: WatchStreamDeps) {
    this.deps = deps;
  }

  /** Watches the session from `afterSeq` on; a stream of an older session is closed. */
  restart(sessionId: string, afterSeq: bigint, epoch: number): void {
    if (this.disposed) return;
    this.target = { sessionId, epoch };
    this.afterSeq = afterSeq;
    this.failures = 0;
    this.abort?.abort();
    this.wake?.();
    if (!this.running) void this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.target = null;
    this.abort?.abort();
    this.wake?.();
  }

  private async run(): Promise<void> {
    this.running = true;
    for (let target = this.target; target !== null; target = this.target) {
      await this.watch(target);
      // A restart replaced the target: connect to the new one at once.
      if (this.target !== target) continue;
      await this.wait(this.delay());
    }
    this.running = false;
  }

  /** One call of WatchSession until it ends, fails or is aborted. */
  private async watch(target: Target): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    let silence = this.watchSilence(abort);
    try {
      const stream = this.deps.client.watchSession(
        { sessionId: target.sessionId, afterSeq: this.afterSeq },
        { signal: abort.signal },
      );
      for await (const { event } of stream) {
        silence.dispose();
        silence = this.watchSilence(abort);
        this.failures = 0;
        if (event === undefined) continue;
        // A heartbeat carries the seq of the last event, so it never skips one.
        this.afterSeq = event.seq;
        this.deps.onEvent(event);
      }
    } catch (e) {
      if (this.target !== target) return;
      if (toRemoteError(e).reason === 'SESSION_NOT_FOUND') {
        this.target = null;
        this.deps.onSessionNotFound(target.epoch);
      }
    } finally {
      silence.dispose();
      if (this.abort === abort) this.abort = null;
    }
  }

  private watchSilence(abort: AbortController): Disposable {
    return this.deps.timers.schedule(() => {
      abort.abort();
    }, SILENCE_MS);
  }

  /** baseDelayMs × 2ⁿ as the waits of a retry; after its last wait the wait stays the same. */
  private delay(): number {
    const n = Math.min(this.failures, Math.max(0, this.deps.retry.attempts - 2));
    this.failures += 1;
    return this.deps.retry.baseDelayMs * 2 ** n;
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.deps.timers.schedule(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        this.wake = null;
        timer.dispose();
        resolve();
      };
    });
  }
}
