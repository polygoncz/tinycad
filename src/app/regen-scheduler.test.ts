import { describe, expect, it, vi } from 'vitest';
import { createRegenScheduler } from './regen-scheduler';

/** A run the test finishes by hand. */
function deferredRuns(): {
  run: () => Promise<void>;
  finish: () => Promise<void>;
  count: () => number;
} {
  const pending: (() => void)[] = [];
  let count = 0;
  return {
    run: () => {
      count++;
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    finish: async () => {
      pending.shift()?.();
      // Lets the scheduler see the finished run and start the next one.
      await new Promise((r) => setTimeout(r, 0));
    },
    count: () => count,
  };
}

describe('RegenScheduler', () => {
  it('starts a run at once on request', () => {
    const runs = deferredRuns();
    const scheduler = createRegenScheduler({ run: runs.run, onError: vi.fn() });
    scheduler.request();
    expect(runs.count()).toBe(1);
    expect(scheduler.busy.get()).toBe(true);
  });

  it('runs once more after the running run, however many requests came meanwhile', async () => {
    const runs = deferredRuns();
    const scheduler = createRegenScheduler({ run: runs.run, onError: vi.fn() });
    for (let i = 0; i < 10; i++) scheduler.request();
    expect(runs.count()).toBe(1);
    await runs.finish();
    expect(runs.count()).toBe(2);
    await runs.finish();
    expect(runs.count()).toBe(2);
    expect(scheduler.busy.get()).toBe(false);
  });

  it('does not run again when nothing was requested during the run', async () => {
    const runs = deferredRuns();
    const scheduler = createRegenScheduler({ run: runs.run, onError: vi.fn() });
    scheduler.request();
    await runs.finish();
    expect(runs.count()).toBe(1);
    expect(scheduler.busy.get()).toBe(false);
  });

  it('reports a failed run and keeps working', async () => {
    const onError = vi.fn();
    let fail = true;
    let count = 0;
    const scheduler = createRegenScheduler({
      run: () => {
        count++;
        return fail ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      onError,
    });
    scheduler.request();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(scheduler.busy.get()).toBe(false);
    fail = false;
    scheduler.request();
    await new Promise((r) => setTimeout(r, 0));
    expect(count).toBe(2);
  });

  it('busy follows the runs', async () => {
    const runs = deferredRuns();
    const scheduler = createRegenScheduler({ run: runs.run, onError: vi.fn() });
    const seen: boolean[] = [];
    scheduler.busy.subscribe(() => seen.push(scheduler.busy.get()));
    scheduler.request();
    scheduler.request();
    await runs.finish();
    await runs.finish();
    // Busy through both runs, not toggled between them.
    expect(seen).toEqual([true, false]);
  });

  it('after dispose neither starts nor repeats a run', async () => {
    const runs = deferredRuns();
    const scheduler = createRegenScheduler({ run: runs.run, onError: vi.fn() });
    scheduler.request();
    scheduler.request();
    scheduler.dispose();
    await runs.finish();
    scheduler.request();
    expect(runs.count()).toBe(1);
  });
});
