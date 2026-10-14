// The grid of the sketch plane (spec 09, "Skici", M19.2 D4): the step follows the zoom along the
// series 1–2–5 × 10ⁿ mm, so the lines are never closer than about 10 px, and every fifth line is
// major. Pure, no three; the sketch layer turns the lines into geometry in the plane of the edited
// sketch, and the sketcher snaps new points to the same step.

import type { Vec2 } from '@/core';

/** The smallest gap between two grid lines, in CSS px. */
const MIN_STEP_PX = 10;
/** Mantissas of the steps within one decade. */
const MANTISSAS = [1, 2, 5, 10] as const;
/** At most this many lines run along each axis; a finer grid doubles its step. */
const MAX_LINES_PER_AXIS = 400;
/** Every MAJOR_EVERY-th line is major. */
const MAJOR_EVERY = 5;
/** Floating-point slack of the comparison step ≥ 10 px (0.05 × 10 is not always 0.5). */
const SLACK = 1e-9;

/**
 * The smallest step from 1–2–5 × 10ⁿ mm (n an integer, also negative) at least 10 px wide for
 * `worldPerPx` mm per CSS px. Invalid input (≤ 0, NaN, infinity) gives 1.
 */
export function sketchGridStep(worldPerPx: number): number {
  if (!(worldPerPx > 0) || !Number.isFinite(worldPerPx)) return 1;
  const minimum = MIN_STEP_PX * worldPerPx;
  const n = Math.floor(Math.log10(minimum));
  for (const mantissa of MANTISSAS) {
    const step = decimal(mantissa, n);
    if (step >= minimum * (1 - SLACK)) return step;
  }
  // log10 rounded down a little too far: the next decade.
  return decimal(1, n + 1);
}

/**
 * Grid lines of the square center ± halfExtent in the coordinates of the plane, as segments
 * u0, v0, u1, v1 each, on the multiples of `step`; a line on a multiple of 5 · step is major.
 * More than 400 lines along an axis double the step until they fit. Invalid step or size → none.
 */
export function gridLines(
  step: number,
  center: Vec2,
  halfExtent: number,
): { minor: number[]; major: number[] } {
  const minor: number[] = [];
  const major: number[] = [];
  if (!(step > 0) || !Number.isFinite(step) || !(halfExtent > 0) || !Number.isFinite(halfExtent)) {
    return { minor, major };
  }
  const [cu, cv] = center;
  let spacing = step;
  while (2 * halfExtent > MAX_LINES_PER_AXIS * spacing - spacing) spacing *= 2;
  const lines = (c: number): readonly (readonly [coordinate: number, isMajor: boolean])[] => {
    const first = Math.ceil((c - halfExtent) / spacing);
    const last = Math.floor((c + halfExtent) / spacing);
    const result: (readonly [number, boolean])[] = [];
    for (let k = first; k <= last; k++) {
      // + 0 turns −0 (k = −0 from Math.ceil of a small negative number) into +0.
      result.push([k * spacing + 0, k % MAJOR_EVERY === 0]);
    }
    return result;
  };
  for (const [u, isMajor] of lines(cu)) {
    (isMajor ? major : minor).push(u, cv - halfExtent, u, cv + halfExtent);
  }
  for (const [v, isMajor] of lines(cv)) {
    (isMajor ? major : minor).push(cu - halfExtent, v, cu + halfExtent, v);
  }
  return { minor, major };
}

/** mantissa × 10ⁿ, divided for a negative n so that 0.2 is the double nearest to 0.2. */
function decimal(mantissa: number, n: number): number {
  return n >= 0 ? mantissa * 10 ** n : mantissa / 10 ** -n;
}
