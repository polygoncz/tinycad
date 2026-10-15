import { describe, expect, it, vi } from 'vitest';
import { createRegenScheduler } from '@/app/regen-scheduler';

/** A run the test finishes or fails by hand. */
function deferredRuns(): {
  run: () => Promise<void>;
  finish: () => Promise<void>;
  fail: (error: unknown) => Promise<void>;
  count: () => number;
} {
  const pending: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  let count = 0;
  /** Lets the scheduler see the settled run and start the next one. */
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    run: () => {
      count++;
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    finish: async () => {
      pending.shift()?.resolve();
      await settle();
    },
    fail: async (error) => {
      pending.shift()?.reject(error);
      await settle();
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

  it('runs once more after a failed run, however many requests came during it', async () => {
    const runs = deferredRuns();
    const onError = vi.fn();
    const scheduler = createRegenScheduler({ run: runs.run, onError });
    scheduler.request();
    scheduler.request();
    scheduler.request();
    await runs.fail(new Error('boom'));
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('boom'));
    // The failure does not drop the requests made meanwhile: one catch-up run, still busy.
    expect(runs.count()).toBe(2);
    expect(scheduler.busy.get()).toBe(true);
    await runs.finish();
    expect(runs.count()).toBe(2);
    expect(scheduler.busy.get()).toBe(false);
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
