import { assert } from '@/core';
import type { Vec2 } from '@/core';
import { curvePoints } from './edit';
import { pointsById } from './points';
import type { SketchData, SketchEntity, SketchEntityId, SketchPoint } from './model';
import { cross, dist, dot, length, sub } from './vec2';

// Angle and length constraints of a new line or radius, after the snapper has placed its points
// (spec 12 "Snapper a auto-vazby (M26)"). Pure; the solver checks the candidates when written.

export type LineInference =
  | { readonly kind: 'horizontal' | 'vertical' }
  | { readonly kind: 'parallel' | 'perpendicular' | 'equal'; readonly line: SketchEntityId }
  | { readonly kind: 'tangent'; readonly curve: SketchEntityId };

/** Equal length or radius: the values differ by at most this part of the larger one. */
const EQUAL_TOLERANCE = 0.02;

/**
 * The constraints of a new line from `from` to `to`: an axis within angleTolerance; parallel or
 * perpendicular to a line and tangent to an arc that uses from.point (the axis wins over parallel
 * and perpendicular); equal with `previous` within 2 %. At most one per pair of entities; order:
 * axis, curves in data order, equal.
 */
export function inferLine(
  from: { readonly at: Vec2; readonly point: SketchEntityId | null },
  to: Vec2,
  data: SketchData,
  opts: { readonly previous: SketchEntityId | null; readonly angleTolerance: number },
): readonly LineInference[] {
  const d = sub(to, from.at);
  if (isZero(d)) return [];
  const tol = opts.angleTolerance;
  const out: LineInference[] = [];
  const paired = new Set<SketchEntityId>();

  if (isParallel(d, [1, 0], tol)) out.push({ kind: 'horizontal' });
  else if (isParallel(d, [0, 1], tol)) out.push({ kind: 'vertical' });
  const axis = out.length > 0;

  const points = pointsById(data);
  if (from.point !== null) {
    for (const e of data.entities) {
      if (e.kind === 'line' && !axis && curvePoints(e).includes(from.point)) {
        const other = sub(at(points, e.p2), at(points, e.p1));
        if (isZero(other)) continue;
        if (isParallel(d, other, tol)) out.push({ kind: 'parallel', line: e.id });
        else if (isPerpendicular(d, other, tol)) out.push({ kind: 'perpendicular', line: e.id });
        else continue;
        paired.add(e.id);
      } else if (e.kind === 'arc' && (e.start === from.point || e.end === from.point)) {
        // The tangent at `from` is perpendicular to the radius there.
        const radius = sub(from.at, at(points, e.center));
        if (isZero(radius) || !isPerpendicular(d, radius, tol)) continue;
        out.push({ kind: 'tangent', curve: e.id });
        paired.add(e.id);
      }
    }
  }

  const previous = opts.previous === null ? undefined : find(data, opts.previous);
  if (previous?.kind === 'line' && !paired.has(previous.id)) {
    if (nearlyEqual(length(d), dist(at(points, previous.p1), at(points, previous.p2)))) {
      out.push({ kind: 'equal', line: previous.id });
    }
  }
  return out;
}

/**
 * `previous` (the last circle or arc of the data, from the sketcher) when its radius differs from
 * `radius` by at most 2 % of the larger one; otherwise null.
 */
export function inferRadius(
  radius: number,
  data: SketchData,
  previous: SketchEntityId | null,
): SketchEntityId | null {
  const curve = previous === null ? undefined : find(data, previous);
  if (curve?.kind !== 'circle' && curve?.kind !== 'arc') return null;
  const other =
    curve.kind === 'circle'
      ? curve.radius
      : dist(at(pointsById(data), curve.start), at(pointsById(data), curve.center));
  return nearlyEqual(radius, other) ? curve.id : null;
}

/** The acute angle between two directions, in [0, π/2]. */
function angleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(Math.abs(cross(a, b)), Math.abs(dot(a, b)));
}

function isParallel(a: Vec2, b: Vec2, tol: number): boolean {
  return angleBetween(a, b) <= tol;
}

function isPerpendicular(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.PI / 2 - angleBetween(a, b) <= tol;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EQUAL_TOLERANCE * Math.max(a, b);
}

function isZero(v: Vec2): boolean {
  return v[0] === 0 && v[1] === 0;
}

function find(data: SketchData, id: SketchEntityId): SketchEntity | undefined {
  return data.entities.find((e) => e.id === id);
}

/** The coordinates of a point of the data; a missing point is a programming error. */
function at(points: ReadonlyMap<SketchEntityId, SketchPoint>, id: SketchEntityId): Vec2 {
  const p = points.get(id);
  assert(p !== undefined, `infer: missing point '${id}'`);
  return [p.x, p.y];
}
