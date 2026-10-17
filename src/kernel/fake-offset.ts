import type { Vec2 } from '@/core';
import { createKernelError } from './errors';
import { meet, type Offset } from './fake-fillet';
import type { IdentifiedCurve, OffsetCurve, OffsetCurvesInput } from './profile';
import { angleOf, cross, dist, dot, lerp, mod2pi, normalize, sub } from './vec2';

// offsetCurves of the FakeKernel (spec 06 "Stav po M35"), analytically for lines, arcs and
// circles: every curve's carrier is shifted to its right by the signed distance (a line moved
// along its normal, an arc's circle grown or shrunk), neighbours meet in the common point of
// their offsets (a tangent join) or the intersection of their carriers nearest it (a sharp
// corner, outwards extended, inwards cut). It drops no curve: a curve that would vanish, a
// spline and a carrier that shrinks to nothing reject with 'operation-failed'. Internal to kernel.

/** Tolerance of the formulas, times the scale (as the regions, the intersections and the fillet). */
const FORMULA_TOLERANCE = 1e-9;

type Line = Extract<IdentifiedCurve, { kind: 'line' }>;
type Arc = Extract<IdentifiedCurve, { kind: 'arc' }>;
type Segment = Line | Arc;

/** The offset of the checked chain (spec 06 "Stav po M35"), in the order of the chain. */
export function computeOffsetCurves({
  curves,
  closed,
  distance,
}: OffsetCurvesInput): readonly OffsetCurve[] {
  const [first] = curves;
  if (first?.kind === 'circle') {
    const radius = first.radius + distance;
    if (!(radius > FORMULA_TOLERANCE * Math.max(1, first.radius))) {
      throw failure('the circle shrinks to nothing');
    }
    return [{ kind: 'circle', center: first.center, radius, source: first.id }];
  }
  const segments = curves.filter((c): c is Segment => c.kind === 'line' || c.kind === 'arc');
  if (segments.length !== curves.length) {
    throw failure('the FakeKernel offsets only lines, arcs and circles');
  }
  const scale = Math.max(1, Math.abs(distance), ...segments.flatMap(coordinatesOf).map(Math.abs));
  const tol = FORMULA_TOLERANCE * scale;
  // Closed > 0 is outwards: the right side of a counter-clockwise loop, the left of a clockwise one.
  const right = closed && signedArea(segments) < 0 ? -distance : distance;
  const shifted = segments.map((s) => shift(s, right, tol));
  const n = segments.length;
  const corners = Array.from({ length: closed ? n : n - 1 }, (_, i) =>
    cornerOf(shifted[i], shifted[(i + 1) % n], tol),
  );
  return shifted.map((s, i): OffsetCurve => {
    const from = i > 0 ? corners[i - 1] : closed ? corners[n - 1] : s.from;
    const to = i < n - 1 || closed ? corners[i] : s.to;
    return trimmed(s, from ?? s.from, to ?? s.to, tol);
  });
}

/** A curve shifted to its right, with its carrier: the ends moved, not yet trimmed or extended. */
interface Shifted {
  readonly curve: Segment;
  readonly carrier: Offset;
  readonly from: Vec2;
  readonly to: Vec2;
}

function shift(curve: Segment, right: number, tol: number): Shifted {
  if (curve.kind === 'line') {
    const d = normalize(sub(curve.to, curve.from));
    const n: Vec2 = [d[1], -d[0]];
    const from = lerp(curve.from, n, right);
    return { curve, carrier: { kind: 'line', p: from, d }, from, to: lerp(curve.to, n, right) };
  }
  // To the right of a counter-clockwise arc is away from its center.
  const rho = dist(curve.center, curve.from);
  const r = curve.ccw ? rho + right : rho - right;
  if (!(r > tol)) throw failure(`the arc ${curve.id} shrinks to nothing`);
  const onCircle = (p: Vec2): Vec2 => lerp(curve.center, sub(p, curve.center), r / rho);
  return {
    curve,
    carrier: { kind: 'circle', c: curve.center, r },
    from: onCircle(curve.from),
    to: onCircle(curve.to),
  };
}

/**
 * The corner between `a` and the next curve `b`: the common end of their offsets where they join
 * tangentially, otherwise the intersection of their carriers nearest the two ends.
 */
function cornerOf(a: Shifted | undefined, b: Shifted | undefined, tol: number): Vec2 {
  if (a === undefined || b === undefined) throw failure('a corner without its curves');
  if (dist(a.to, b.from) <= tol) return a.to;
  const middle = lerp(a.to, sub(b.from, a.to), 0.5);
  let corner: Vec2 | undefined;
  for (const p of meet(a.carrier, b.carrier, middle, tol)) {
    if (corner === undefined || dist(p, middle) < dist(corner, middle)) corner = p;
  }
  if (corner === undefined) {
    throw failure(`the offsets of ${a.curve.id} and ${b.curve.id} do not meet`);
  }
  return corner;
}

/** The offset curve from `from` to `to`; rejects when it vanished (its ends crossed). */
function trimmed({ curve, carrier }: Shifted, from: Vec2, to: Vec2, tol: number): OffsetCurve {
  if (curve.kind === 'line') {
    if (!(dot(sub(to, from), sub(curve.to, curve.from)) > tol * dist(curve.from, curve.to))) {
      throw failure(`the line ${curve.id} vanishes`);
    }
    return { kind: 'line', from, to, source: curve.id };
  }
  // The sweep after moving both ends: each end turns by less than half a turn.
  const { center, ccw } = curve;
  const sense = ccw ? 1 : -1;
  const turn = (p: Vec2, q: Vec2): number =>
    sense * (angleOf(sub(p, center)) - angleOf(sub(q, center)));
  const halfTurn = (a: number): number => mod2pi(a + Math.PI) - Math.PI;
  const sweep = mod2pi(turn(curve.to, curve.from));
  const r = carrier.kind === 'circle' ? carrier.r : 1;
  if (!(sweep - halfTurn(turn(from, curve.from)) + halfTurn(turn(to, curve.to)) > tol / r)) {
    throw failure(`the arc ${curve.id} vanishes`);
  }
  return { kind: 'arc', center, from, to, ccw, source: curve.id };
}

/** The signed area of a closed chain of lines and arcs: > 0 counter-clockwise. */
function signedArea(segments: readonly Segment[]): number {
  let area = 0;
  for (const s of segments) {
    area += cross(s.from, s.to) / 2;
    if (s.kind === 'arc') {
      // The circular segment between the arc and its chord.
      const r = dist(s.center, s.from);
      const sweep = mod2pi(
        (s.ccw ? 1 : -1) * (angleOf(sub(s.to, s.center)) - angleOf(sub(s.from, s.center))),
      );
      area += ((s.ccw ? 1 : -1) * r * r * (sweep - Math.sin(sweep))) / 2;
    }
  }
  return area;
}

function coordinatesOf(s: Segment): readonly number[] {
  return s.kind === 'line' ? [...s.from, ...s.to] : [...s.center, ...s.from, ...s.to];
}

function failure(reason: string): Error {
  return createKernelError('operation-failed', `offsetCurves: ${reason}`);
}
