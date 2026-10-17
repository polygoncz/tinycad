// At most one request in flight per method (spec 14 "GeometryService", Q096, N6): over a slow
// network a tool that asks on every mouse move must not pile up requests. Calls made while one is
// in flight wait in a FIFO queue. A queued call with a coalescing key replaces the queued call
// with the same key (the newer state of the same question wins, and the replaced callers get its
// answer); calls without a key, or with another key, are never dropped, so every caller asking
// its own question gets the answer to it.

interface Caller<Res> {
  readonly resolve: (value: Res) => void;
  readonly reject: (reason: unknown) => void;
}

/** A queued request with everybody waiting for its answer. */
interface Queued<Req, Res> {
  readonly key: string | null;
  readonly request: Req;
  readonly callers: readonly Caller<Res>[];
}

/**
 * Wraps `send` so that at most one call of it runs at a time; the rest wait in order. `keyOf`
 * gives the coalescing key of a request, or null (the default) for a request that never coalesces.
 * The call in flight is never replaced: it resolves with its own answer.
 */
export function coalescingQueue<Req, Res>(
  send: (request: Req) => Promise<Res>,
  keyOf: (request: Req) => string | null = () => null,
): (request: Req) => Promise<Res> {
  let inFlight = false;
  let queue: readonly Queued<Req, Res>[] = [];

  function run(item: Queued<Req, Res>): void {
    inFlight = true;
    // A synchronous throw of send rejects too, so the method is never stuck in flight.
    const answer = new Promise<Res>((resolve) => {
      resolve(send(item.request));
    });
    answer.then(
      (value) => {
        for (const c of item.callers) c.resolve(value);
        next();
      },
      (reason: unknown) => {
        for (const c of item.callers) c.reject(reason);
        next();
      },
    );
  }

  function next(): void {
    const [head, ...rest] = queue;
    queue = rest;
    if (head === undefined) {
      inFlight = false;
      return;
    }
    run(head);
  }

  return (request) =>
    new Promise<Res>((resolve, reject) => {
      const caller = { resolve, reject };
      if (!inFlight) {
        run({ key: null, request, callers: [caller] });
        return;
      }
      const key = keyOf(request);
      const same = key === null ? -1 : queue.findIndex((q) => q.key === key);
      if (same < 0) {
        queue = [...queue, { key, request, callers: [caller] }];
        return;
      }
      // The newer request takes the place of the queued one with the same key.
      queue = queue.map((q, i) =>
        i === same ? { key, request, callers: [...q.callers, caller] } : q,
      );
    });
}
