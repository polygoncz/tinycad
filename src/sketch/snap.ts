import type { Vec2 } from '@/core';
import { assertNever, bspline } from '@/core';
import { curve2, pointsById } from './geometry';
import type { Curve2 } from './geometry';
import type { SketchCurve, SketchData, SketchEntity, SketchEntityId, SketchPoint } from './model';
import { SPLINE_TOLERANCE } from './regions';
import { angleOf, dist, dot, length, lerp, mod2pi, sub } from './vec2';

// The snapper of the sketcher tools (spec 12 "Snapper a auto-vazby (M26)"): where a click lands in
// plane coordinates (mm) and which constraints the new point gets. Pure and synchronous, so it
// runs on every pointer move; the sketcher only converts the cursor and the 6 px tolerance.

export interface SnapOptions {
  /** Snap distance in mm = 6 px converted at the cursor (the sketcher computes it from the view). */
  readonly tolerance: number;
  /** Grid step in mm, null = no grid (off or Alt). */
  readonly grid: number | null;
  /** false = Ctrl/Cmd: only an existing point, the origin and the grid, no other snaps or constraints. */
  readonly infer: boolean;
  /** Entities that are not snapped to (the item in progress of a tool). */
  readonly exclude?: ReadonlySet<SketchEntityId>;
}

export type SnapKind =
  'point' | 'origin' | 'midpoint' | 'onCurve' | 'alignBoth' | 'align' | 'grid' | 'free';

/** A constraint of the point that is yet to be created (the tool gives it its id). */
export type PointInference =
  /** The origin. */
  | { readonly kind: 'fix' }
  | { readonly kind: 'pointOnCurve'; readonly curve: SketchEntityId }
  | { readonly kind: 'midpoint'; readonly line: SketchEntityId }
  /** With an existing point. */
  | { readonly kind: 'hAlign' | 'vAlign'; readonly with: SketchEntityId };

/** A dotted guide from a point to the cursor. */
export interface SnapGuide {
  readonly axis: 'h' | 'v';
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface SnapResult {
  readonly at: Vec2;
  readonly kind: SnapKind;
  /** The existing point whose id is reused (kind 'point'); otherwise null. */
  readonly point: SketchEntityId | null;
  readonly inferred: readonly PointInference[];
  readonly guides: readonly SnapGuide[];
}

export const ORIGIN_SNAP: Vec2 = Object.freeze([0, 0] as const);

/**
 * Where the cursor snaps: the first step of spec 12 that applies – an existing point, the origin,
 * a midpoint of a line, a curve, alignment with two points, with one point, the grid, the cursor.
 * An xline (M31) snaps only at p1, p2 (points) and on its whole carrier line, not at the ends or
 * the middle of the long line curve2 draws it as.
 * Steps 3–6 only with `infer`. A tie of distances is won by the earlier entity in the data.
 */
export function snap(cursor: Vec2, data: SketchData, opts: SnapOptions): SnapResult {
  const { tolerance, exclude } = opts;
  const included = (e: SketchEntity): boolean => exclude?.has(e.id) !== true;
  const points = data.entities.filter(isPoint).filter(included);

  const point = nearest(points, (p) => dist(cursor, at(p)), tolerance);
  if (point !== null) return result(at(point.item), 'point', point.item.id);

  if (dist(cursor, ORIGIN_SNAP) <= tolerance) {
    return result(ORIGIN_SNAP, 'origin', null, [{ kind: 'fix' }]);
  }

  if (opts.infer) {
    const inferred = inferredSnap(cursor, data, points, opts, included);
    if (inferred !== null) return inferred;
  }

  if (opts.grid !== null) return result(toGrid(cursor, opts.grid), 'grid');
  return result(cursor, 'free');
}

/** Steps 3–6: a midpoint, a curve, alignment; null when none applies. */
function inferredSnap(
  cursor: Vec2,
  data: SketchData,
  points: readonly SketchPoint[],
  opts: SnapOptions,
  included: (e: SketchEntity) => boolean,
): SnapResult | null {
  const { tolerance } = opts;
  const byId = pointsById(data);
  const curves = data.entities
    .filter(isCurve)
    .filter(included)
    // An xline (M31) is drawn as a long line, but has no midpoint and projects without clamping.
    .map((c) => ({ id: c.id, shape: curve2(c, byId), infinite: c.kind === 'xline' }));

  const mid = nearest(
    curves,
    (c) => (c.shape.kind === 'line' && !c.infinite ? dist(cursor, midpointOf(c.shape)) : Infinity),
    tolerance,
  );
  if (mid !== null && mid.item.shape.kind === 'line') {
    return result(midpointOf(mid.item.shape), 'midpoint', null, [
      { kind: 'midpoint', line: mid.item.id },
    ]);
  }

  // The tessellation tolerance of a spline is relative to the sketch scale, as in regions.
  const scale = Math.max(1, ...[...byId.values()].flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  const splineTolerance = SPLINE_TOLERANCE * scale;
  const projections = curves.map((c) => ({
    id: c.id,
    at:
      c.infinite && c.shape.kind === 'line'
        ? onCarrier(cursor, c.shape.from, c.shape.to)
        : project(cursor, c.shape, splineTolerance),
  }));
  const onCurve = nearest(
    projections,
    (p) => (p.at === null ? Infinity : dist(cursor, p.at)),
    tolerance,
  );
  if (onCurve !== null && onCurve.item.at !== null) {
    return result(onCurve.item.at, 'onCurve', null, [
      { kind: 'pointOnCurve', curve: onCurve.item.id },
    ]);
  }

  return alignSnap(cursor, points, opts);
}

/** Steps 5 and 6: alignment with the vertical (same x) and the horizontal (same y) of points. */
function alignSnap(
  cursor: Vec2,
  points: readonly SketchPoint[],
  opts: SnapOptions,
): SnapResult | null {
  const { tolerance, grid } = opts;
  const v = nearest(points, (p) => Math.abs(cursor[0] - p.x), tolerance);
  const h = nearest(points, (p) => Math.abs(cursor[1] - p.y), tolerance);
  if (v !== null && h !== null && v.item !== h.item) {
    const to: Vec2 = [v.item.x, h.item.y];
    return result(
      to,
      'alignBoth',
      null,
      [
        { kind: 'vAlign', with: v.item.id },
        { kind: 'hAlign', with: h.item.id },
      ],
      [
        { axis: 'v', from: at(v.item), to },
        { axis: 'h', from: at(h.item), to },
      ],
    );
  }
  // One point near both of its axes would put the new point onto it: keep the nearer alignment.
  const axis = v !== null && (h === null || v.distance <= h.distance) ? 'v' : 'h';
  const hit = axis === 'v' ? v : h;
  if (hit === null) return null;
  const free = grid === null ? cursor : toGrid(cursor, grid);
  const to: Vec2 = axis === 'v' ? [hit.item.x, free[1]] : [free[0], hit.item.y];
  return result(
    to,
    'align',
    null,
    [{ kind: axis === 'v' ? 'vAlign' : 'hAlign', with: hit.item.id }],
    [{ axis, from: at(hit.item), to }],
  );
}

function result(
  at: Vec2,
  kind: SnapKind,
  point: SketchEntityId | null = null,
  inferred: readonly PointInference[] = [],
  guides: readonly SnapGuide[] = [],
): SnapResult {
  return { at, kind, point, inferred, guides };
}

/** The item with the smallest distance ≤ tolerance; the first one wins a tie. */
function nearest<T>(
  items: readonly T[],
  distance: (item: T) => number,
  tolerance: number,
): { readonly item: T; readonly distance: number } | null {
  let best: { readonly item: T; readonly distance: number } | null = null;
  for (const item of items) {
    const d = distance(item);
    if (d <= tolerance && (best === null || d < best.distance)) best = { item, distance: d };
  }
  return best;
}

/**
 * The nearest point of the curve: within the segment of a line, within the range of an arc; on a
 * spline the nearest point of its tessellation (each segment like a line).
 */
function project(p: Vec2, c: Curve2, splineTolerance: number): Vec2 | null {
  switch (c.kind) {
    case 'line':
      return onSegment(p, c.from, c.to);
    case 'circle':
      return onCircle(p, c.center, c.radius);
    case 'arc': {
      const start = angleOf(sub(c.from, c.center));
      const sweep = mod2pi(angleOf(sub(c.to, c.center)) - start);
      if (mod2pi(angleOf(sub(p, c.center)) - start) > sweep) return null;
      return onCircle(p, c.center, length(sub(c.from, c.center)));
    }
    case 'bspline':
      return onPolyline(p, bspline.tessellate(c, splineTolerance));
    default:
      return assertNever(c);
  }
}

/** The projection on the segment from–to, clamped to its ends. */
function onSegment(p: Vec2, from: Vec2, to: Vec2): Vec2 {
  const d = sub(to, from);
  const len2 = dot(d, d);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, from), d) / len2));
  return lerp(from, d, t);
}

/** The projection on the whole line through from and to (from ≠ to), not clamped. */
function onCarrier(p: Vec2, from: Vec2, to: Vec2): Vec2 {
  const d = sub(to, from);
  return lerp(from, d, dot(sub(p, from), d) / dot(d, d));
}

/** The nearest projection on the segments of the polyline; the first segment wins a tie. */
function onPolyline(p: Vec2, polyline: readonly Vec2[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const from = polyline[i - 1];
    const to = polyline[i];
    if (from === undefined || to === undefined) continue;
    const at = onSegment(p, from, to);
    const d = dist(p, at);
    if (d < bestDistance) {
      best = at;
      bestDistance = d;
    }
  }
  return best;
}

/** The projection on a circle; null at its center (no direction). */
function onCircle(p: Vec2, center: Vec2, radius: number): Vec2 | null {
  const v = sub(p, center);
  const l = length(v);
  return l === 0 ? null : lerp(center, v, radius / l);
}

function midpointOf(l: { readonly from: Vec2; readonly to: Vec2 }): Vec2 {
  return lerp(l.from, sub(l.to, l.from), 0.5);
}

/** The nearest multiple of the step in both coordinates; −0 becomes 0. */
function toGrid(p: Vec2, step: number): Vec2 {
  const round = (v: number): number => Math.round(v / step) * step + 0;
  return [round(p[0]), round(p[1])];
}

function at(p: SketchPoint): Vec2 {
  return [p.x, p.y];
}

function isPoint(e: SketchEntity): e is SketchPoint {
  return e.kind === 'point';
}

function isCurve(e: SketchEntity): e is SketchCurve {
  return e.kind !== 'point';
}
