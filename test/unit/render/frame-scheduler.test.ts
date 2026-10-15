import { describe, expect, it } from 'vitest';
import { createFrameScheduler } from '@/render/frame-scheduler';

/** A manual requestAnimationFrame: frames run only when the test calls flush(). */
function manualFrames() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    requestFrame: (cb: () => void): number => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame: (id: number): void => {
      pending.delete(id);
    },
    pendingCount: (): number => pending.size,
    flush: (): void => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

describe('createFrameScheduler', () => {
  it('schedules at most one frame for repeated requests', () => {
    const frames = manualFrames();
    let draws = 0;
    const scheduler = createFrameScheduler({ ...frames, draw: () => draws++ });

    scheduler.request();
    scheduler.request();
    scheduler.request();
    expect(frames.pendingCount()).toBe(1);

    frames.flush();
    expect(draws).toBe(1);
    expect(frames.pendingCount()).toBe(0);
  });

  it('does not draw without a request', () => {
    const frames = manualFrames();
    let draws = 0;
    createFrameScheduler({ ...frames, draw: () => draws++ });
    frames.flush();
    expect(draws).toBe(0);
    expect(frames.pendingCount()).toBe(0);
  });

  it('schedules another frame when requested during draw', () => {
    const frames = manualFrames();
    let draws = 0;
    const scheduler = createFrameScheduler({
      ...frames,
      draw: () => {
        draws++;
        if (draws === 1) scheduler.request();
      },
    });

    scheduler.request();
    frames.flush();
    expect(draws).toBe(1);
    expect(frames.pendingCount()).toBe(1);

    frames.flush();
    expect(draws).toBe(2);
    expect(frames.pendingCount()).toBe(0);
  });

  it('dispose cancels the scheduled frame and later requests are no-ops', () => {
    const frames = manualFrames();
    let draws = 0;
    const scheduler = createFrameScheduler({ ...frames, draw: () => draws++ });

    scheduler.request();
    scheduler.dispose();
    expect(frames.pendingCount()).toBe(0);

    scheduler.request();
    expect(frames.pendingCount()).toBe(0);
    frames.flush();
    expect(draws).toBe(0);
    expect(() => {
      scheduler.dispose();
    }).not.toThrow();
  });
});
