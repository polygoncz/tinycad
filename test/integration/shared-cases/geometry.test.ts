// The runner of the shared cases geometry.* (spec 13, Druhy případů; spec 14, GeometryService):
// the 2D geometry of the sketcher over the OCCT kernel. The input has the shape of the port
// SketchGeometry (sketch/geometry-port.ts); the runner turns it into the request of the
// GeometryKernel method the adapter SketchGeometry forwards to. The curves go to the kernel
// unchecked: checking them is the kernel's job, and the error cases pin its KernelErrorCode.

import type { Vec2 } from '@/core';
import { kernelErrorCode } from '@/kernel';
import type { GeometryKernel, ProfileCurve } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { beforeAll } from 'vitest';
import type { CaseOutcome } from './support/case';
import { describeSharedCases } from './support/runner';

let kernel: GeometryKernel | undefined;

beforeAll(async () => {
  kernel = await createInThreadOcctKernel();
});

function occt(): GeometryKernel {
  if (kernel === undefined) throw new Error('The OCCT kernel is not loaded yet');
  return kernel;
}

describeSharedCases(
  'geometry',
  {
    // The port orders the hits by a, b (the order of the input), ta: kept as the kernel gives it.
    'geometry.intersections': {
      run: (input) =>
        outcomeOf(async () => {
          const fields = fieldsOf(input, ['curves']);
          const hits = await occt().curveIntersections({ curves: curvesOf(fields['curves']) });
          return { hits };
        }),
    },
    'geometry.segment': {
      run: (input) =>
        outcomeOf(async () => {
          const fields = fieldsOf(input, ['curve', 'from', 'to']);
          const curve = await occt().curveSegment({
            curve: curveOf(fields['curve']),
            from: numberOf(fields['from'], 'from'),
            to: numberOf(fields['to'], 'to'),
          });
          return { curve };
        }),
    },
    'geometry.fillet': {
      run: (input) =>
        outcomeOf(async () => {
          const fields = fieldsOf(input, ['a', 'b', 'radius', 'near']);
          return occt().filletArc({
            a: curveOf(fields['a']),
            b: curveOf(fields['b']),
            radius: numberOf(fields['radius'], 'radius'),
            near: vec2Of(fields['near'], 'near'),
          });
        }),
    },
    // The port orders the result along the chain: kept as the kernel gives it.
    'geometry.offset': {
      run: (input) =>
        outcomeOf(async () => {
          const fields = fieldsOf(input, ['chain', 'closed', 'distance']);
          const closed = fields['closed'];
          if (typeof closed !== 'boolean') throw new Error('input.closed must be a boolean');
          const curves = await occt().offsetCurves({
            curves: curvesOf(fields['chain']),
            closed,
            distance: numberOf(fields['distance'], 'distance'),
          });
          return { curves };
        }),
    },
  },
  { timeout: 30_000 },
);

/** The output of a call, or its KernelErrorCode; any other throw is a broken case or a bug. */
async function outcomeOf(call: () => Promise<unknown>): Promise<CaseOutcome> {
  try {
    return { ok: await call() };
  } catch (e) {
    const code = kernelErrorCode(e);
    if (code === undefined) throw e;
    return { error: { code } };
  }
}

/** The input as an object with exactly these keys; a malformed one is a broken case. */
function fieldsOf(
  input: unknown,
  keys: readonly string[],
): Readonly<Partial<Record<string, unknown>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('input must be an object');
  }
  const actual = Object.keys(input).sort();
  const wanted = [...keys].sort();
  if (actual.join(',') !== wanted.join(',')) {
    throw new Error(`input must have the keys ${wanted.join(', ')}, has ${actual.join(', ')}`);
  }
  // A non-null, non-array object, its keys checked just above.
  return input as Readonly<Partial<Record<string, unknown>>>;
}

/** A list of curves for the kernel; the curves themselves the kernel checks. */
function curvesOf(value: unknown): readonly ProfileCurve[] {
  if (!Array.isArray(value)) throw new Error('the curves must be an array');
  return value.map(curveOf);
}

/** A curve for the kernel; only that it is an object, its fields the kernel checks. */
function curveOf(value: unknown): ProfileCurve {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('a curve must be an object');
  }
  // Unchecked on purpose: the kernel validates its input (the error cases rely on that).
  return value as ProfileCurve;
}

function numberOf(value: unknown, what: string): number {
  if (typeof value !== 'number') throw new Error(`input.${what} must be a number`);
  return value;
}

function vec2Of(value: unknown, what: string): Vec2 {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number'
  ) {
    throw new Error(`input.${what} must be [x, y]`);
  }
  return [value[0], value[1]];
}
