import { Code, createClient } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { ErrorReason, SessionService } from '@/protocol';
import type { SessionEvent } from '@/protocol';
import { aCoreError, createFakeCore, createManualTimers } from '@/remote/testing';
import { SILENCE_MS, WatchStream } from '@/remote/watch';

/** Lets the router transport and the stream loop run (no time passes). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

function setup() {
  const core = createFakeCore();
  const timers = createManualTimers();
  const events: SessionEvent[] = [];
  const notFound: number[] = [];
  const watch = new WatchStream({
    client: createClient(SessionService, core.transport),
    timers,
    retry: { attempts: 5, baseDelayMs: 200 },
    onEvent: (event) => events.push(event),
    onSessionNotFound: (epoch) => notFound.push(epoch),
  });
  const watched = () => core.requests('watchSession').map((r) => [r.sessionId, r.afterSeq]);
  return { core, timers, events, notFound, watch, watched };
}

const changed = (seq: bigint, by = 'other') => ({
  seq,
  event: { case: 'changed' as const, value: { generation: seq, lastSeq: 0n, bySessionId: by } },
});

const unavailable = () => aCoreError(Code.Unavailable, ErrorReason.UNSPECIFIED);

describe('WatchStream', () => {
  it('watches the session after the given seq and passes every event on', async () => {
    const { core, events, watch, watched } = setup();
    watch.restart('s1', 7n, 1);
    await flush();
    expect(watched()).toEqual([['s1', 7n]]);
    core.emit({ event: changed(8n) });
    core.emit({ event: { seq: 8n, event: { case: 'heartbeat', value: {} } } });
    await flush();
    expect(events.map((e) => [e.seq, e.event.case])).toEqual([
      [8n, 'changed'],
      [8n, 'heartbeat'],
    ]);
    watch.dispose();
  });

  it('after a failure connects again after the last event, waiting as a retry', async () => {
    const { core, timers, watch, watched } = setup();
    watch.restart('s1', 0n, 1);
    await flush();
    core.emit({ event: changed(1n) });
    core.emit({ event: changed(2n) });
    await flush();
    core.endStreams(unavailable());
    await flush();
    expect(watched()).toHaveLength(1);
    expect(timers.waiting).toContain(200);
    timers.advance(200);
    await flush();
    expect(watched()).toEqual([
      ['s1', 0n],
      ['s1', 2n],
    ]);
    watch.dispose();
  });

  it('an end of the stream with OK also connects again', async () => {
    const { core, timers, watch, watched } = setup();
    watch.restart('s1', 3n, 1);
    await flush();
    core.endStreams();
    await flush();
    timers.advance(200);
    await flush();
    expect(watched()).toEqual([
      ['s1', 3n],
      ['s1', 3n],
    ]);
    watch.dispose();
  });

  it('waits 200 ms × 2ⁿ between failed attempts without a limit, the last wait of a retry at most', async () => {
    const { core, timers, watch, watched } = setup();
    watch.restart('s1', 0n, 1);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      await flush();
      core.endStreams(unavailable());
      await flush();
      const wait = timers.waiting.find((ms) => ms !== SILENCE_MS) ?? 0;
      waits.push(wait);
      timers.advance(wait);
    }
    await flush();
    expect(waits).toEqual([200, 400, 800, 1600, 1600, 1600]);
    expect(watched()).toHaveLength(7);
    watch.dispose();
  });

  it('an event resets the wait to the first one', async () => {
    const { core, timers, watch } = setup();
    watch.restart('s1', 0n, 1);
    await flush();
    core.endStreams(unavailable());
    await flush();
    timers.advance(200);
    await flush();
    core.emit({ event: changed(1n) });
    await flush();
    core.endStreams(unavailable());
    await flush();
    expect(timers.waiting.filter((ms) => ms !== SILENCE_MS)).toEqual([200]);
    watch.dispose();
  });

  it('silence longer than two heartbeats closes the stream and connects again', async () => {
    const { core, timers, watch, watched } = setup();
    watch.restart('s1', 0n, 1);
    await flush();
    timers.advance(SILENCE_MS - 1);
    core.emit({ event: { seq: 0n, event: { case: 'heartbeat', value: {} } } });
    await flush();
    timers.advance(SILENCE_MS - 1); // the heartbeat started a new watch of silence
    await flush();
    expect(core.openStreams).toBe(1);
    timers.advance(1);
    await flush();
    expect(core.openStreams).toBe(0);
    timers.advance(200);
    await flush();
    expect(watched()).toHaveLength(2);
    expect(core.openStreams).toBe(1);
    watch.dispose();
  });

  it('SESSION_NOT_FOUND stops the stream until a restart with the new session', async () => {
    const { core, timers, notFound, watch, watched } = setup();
    watch.restart('s1', 5n, 1);
    await flush();
    core.endStreams(aCoreError(Code.NotFound, ErrorReason.SESSION_NOT_FOUND));
    await flush();
    expect(notFound).toEqual([1]);
    timers.advance(10_000);
    await flush();
    expect(watched()).toHaveLength(1);
    watch.restart('s2', 0n, 2);
    await flush();
    expect(watched()).toEqual([
      ['s1', 5n],
      ['s2', 0n],
    ]);
    watch.dispose();
  });

  it('a restart closes the stream of the old session and connects at once', async () => {
    const { core, watch, watched } = setup();
    watch.restart('s1', 5n, 1);
    await flush();
    watch.restart('s2', 1n, 2);
    await flush();
    expect(watched()).toEqual([
      ['s1', 5n],
      ['s2', 1n],
    ]);
    expect(core.openStreams).toBe(1);
    watch.dispose();
  });

  it('dispose closes the stream and never connects again', async () => {
    const { core, timers, watch, watched } = setup();
    watch.restart('s1', 0n, 1);
    await flush();
    watch.dispose();
    await flush();
    expect(core.openStreams).toBe(0);
    timers.advance(100_000);
    await flush();
    expect(watched()).toHaveLength(1);
  });
});
