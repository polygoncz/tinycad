// Opacity transition of the view cube (spec 09, "View cube" → "Vzhled"): linear, driven by
// tick(now) like the camera animation. Pure, no three or DOM import.

/** Opacity at rest and under the pointer, transition in ms. */
export const VIEW_CUBE_OPACITY = { rest: 0.55, active: 1, duration: 150 } as const;

export interface Fade {
  /** Value after the last tick (or the start value of a new transition before it). */
  readonly value: number;
  /** Starts a transition from the value at `now` to `target`; the same target = nothing. */
  setTarget(target: number, now: number): void;
  /** Moves the transition to `now`; true = it keeps running. */
  tick(now: number): boolean;
}

export function createFade(initial: number, duration: number): Fade {
  let value = initial;
  let from = initial;
  let to = initial;
  let start = 0;
  let running = false;

  function valueAt(now: number): number {
    if (!running) return value;
    const t = Math.min(Math.max((now - start) / duration, 0), 1);
    return from + (to - from) * t;
  }

  return {
    get value(): number {
      return value;
    },
    setTarget(target: number, now: number): void {
      if (target === to) return;
      value = valueAt(now);
      from = value;
      to = target;
      start = now;
      running = true;
    },
    tick(now: number): boolean {
      if (!running) return false;
      if (now - start >= duration) {
        value = to;
        running = false;
        return false;
      }
      value = valueAt(now);
      return true;
    },
  };
}
