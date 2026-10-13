// The single frame scheduler of the viewport (spec 09, "Vykreslování na požádání"). Pure: the
// browser's requestAnimationFrame/cancelAnimationFrame are injected, so it runs in Node tests.

export interface FrameSchedulerOptions {
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly draw: () => void;
}

export interface FrameScheduler {
  /** Schedules a frame unless one is already scheduled. No-op after dispose. */
  request(): void;
  /** Cancels the scheduled frame; later requests do nothing. Idempotent. */
  dispose(): void;
}

export function createFrameScheduler(options: FrameSchedulerOptions): FrameScheduler {
  const { requestFrame, cancelFrame, draw } = options;
  let pending: number | null = null;
  let disposed = false;

  const onFrame = (): void => {
    // Cleared before draw, so a request made while drawing schedules the next frame.
    pending = null;
    draw();
  };

  return {
    request(): void {
      if (disposed || pending !== null) return;
      pending = requestFrame(onFrame);
    },
    dispose(): void {
      disposed = true;
      if (pending !== null) cancelFrame(pending);
      pending = null;
    },
  };
}
