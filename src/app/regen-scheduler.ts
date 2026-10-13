// RegenScheduler (spec 11, "Pravidla"): one regeneration at a time and no queue. A request during
// a run only marks the document dirty; when the run ends, one more run catches up with every
// change made meanwhile. A running kernel operation is never interrupted (Q010).

import { ObservableValue } from '@/core';
import type { Disposable, Observable } from '@/core';

export interface RegenScheduler extends Disposable {
  /** Starts a run at once, or marks dirty when one is running. */
  request(): void;
  /** true from the start of a run until no run is running or due. */
  readonly busy: Observable<boolean>;
}

export function createRegenScheduler(deps: {
  /** One regeneration of the current document; drops a stale result itself. */
  run: () => Promise<void>;
  /** A run that rejected (a bug, Q043); the scheduler goes on. */
  onError: (error: unknown) => void;
}): RegenScheduler {
  const busy = new ObservableValue(false);
  let running = false;
  let dirty = false;
  let disposed = false;

  async function loop(): Promise<void> {
    running = true;
    busy.set(true);
    do {
      dirty = false;
      try {
        await deps.run();
      } catch (e) {
        deps.onError(e);
      }
    } while (wantsAnotherRun());
    running = false;
    busy.set(false);
  }

  /** A request came during the run (a function: TS would keep `dirty` narrowed to false). */
  function wantsAnotherRun(): boolean {
    return dirty && !disposed;
  }

  return {
    busy: busy.asObservable(),
    request() {
      if (disposed) return;
      if (running) {
        dirty = true;
        return;
      }
      // loop never rejects: run's errors go to onError.
      void loop();
    },
    dispose() {
      disposed = true;
    },
  };
}
