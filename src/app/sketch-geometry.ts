// The SketchGeometry port of the sketcher over the kernel (spec 12 "Geometrie skici v jádře (M30)",
// "Trim, extend, split (M33)" and "Zaoblení a sražení ve skice (M34)", spec 06 "Stav po M33" and
// "Stav po M34", ADR 0028): app owns the kernel client, so it implements the port and hands it to
// the sketcher like the ConstraintSolver.

import type { GeometryKernel } from '@/kernel';
import type { SketchGeometry } from '@/sketch';

/**
 * The port over SketchOps.curveIntersections, curveSegment and filletArc. `kernel` is read on
 * every call, so after a restart the new kernel answers; null (no kernel running) rejects. Curve2
 * and ProfileCurve, CurveHit and CurveIntersection, the FilletArc of both have the same shape
 * (ADR 0017), so the data pass through without a conversion (the assignments below check it). The
 * kernel checks the input (a curve without an id is an error of the caller) and every error is a
 * rejected Promise.
 */
export function createSketchGeometry(kernel: () => GeometryKernel | null): SketchGeometry {
  const live = (): GeometryKernel => {
    const k = kernel();
    if (k === null) throw new Error('No geometry kernel is running');
    return k;
  };
  return Object.freeze({
    async intersections(curves) {
      return live().curveIntersections({ curves });
    },
    async segment(curve, from, to) {
      return live().curveSegment({ curve, from, to });
    },
    async fillet(a, b, radius, near) {
      return live().filletArc({ a, b, radius, near });
    },
  } satisfies SketchGeometry);
}
