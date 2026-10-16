import { assert, assertNever } from '@/core';
import type { Vec2 } from '@/core';
import { measureDraft } from './edit';
import { pointsById } from './points';
import type {
  AngularPlacement,
  DimensionConstraint,
  DimensionKind,
  DimensionPlacement,
  LinearPlacement,
  RadialPlacement,
  SketchConstraintDraft,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from './model';

// Choosing the kind and the placement of a dimension from the cursor (spec 12 "Kóty (M28)",
// "Výběr druhu"). Pure functions in plane coordinates (mm); the sketcher calls them on every move.

/** What a dimension measures, chosen by the selection; the kind comes from the cursor. */
export type DimensionTarget =
  /** Two points or a line (its points). */
  | { readonly kind: 'points'; readonly a: SketchEntityId; readonly b: SketchEntityId }
  | { readonly kind: 'pointLine'; readonly point: SketchEntityId; readonly line: SketchEntityId }
  /** Two lines (parallel ones too; placeDimension then returns null). */
  | { readonly kind: 'lines'; readonly a: SketchEntityId; readonly b: SketchEntityId }
  | { readonly kind: 'round'; readonly curve: SketchEntityId };

type DimensionDraft = Extract<SketchConstraintDraft, { kind: DimensionKind }>;
type LinearKind = 'distance' | 'hDistance' | 'vDistance';

/** Below this a length, a value or a cursor distance is degenerate (spec 12). */
const MIN = 1e-9;

/**
 * The target of the selected entities: 1 line → its points; 2 points → in selection order;
 * point + line (either order) → pointLine, null when the point is an end of the line; 2 lines →
 * in selection order; 1 circle/arc → round; anything else → null.
 */
export function dimensionTarget(selected: readonly SketchEntity[]): DimensionTarget | null {
  const [first, second] = selected;
  if (selected.length === 1 && first !== undefined) {
    if (first.kind === 'line') return { kind: 'points', a: first.p1, b: first.p2 };
    if (first.kind === 'circle' || first.kind === 'arc') return { kind: 'round', curve: first.id };
    return null;
  }
  if (selected.length !== 2 || first === undefined || second === undefined) return null;
  if (first.kind === 'point' && second.kind === 'point') {
    return { kind: 'points', a: first.id, b: second.id };
  }
  if (first.kind === 'line' && second.kind === 'line') {
    return { kind: 'lines', a: first.id, b: second.id };
  }
  const point = first.kind === 'point' ? first : second.kind === 'point' ? second : undefined;
  const line = first.kind === 'line' ? first : second.kind === 'line' ? second : undefined;
  if (point === undefined || line === undefined) return null;
  if (point.id === line.p1 || point.id === line.p2) return null;
  return { kind: 'pointLine', point: point.id, line: line.id };
}

/**
 * The kind, value and placement of a dimension for the cursor in the sketch plane. null =
 * degenerate (zero length, parallel lines, the cursor at the vertex or the centre).
 */
export function placeDimension(
  target: DimensionTarget,
  cursor: Vec2,
  data: SketchData,
): SketchConstraintDraft | null {
  const geo = geometry(data);
  switch (target.kind) {
    case 'points': {
      const a = geo.point(target.a);
      const b = geo.point(target.b);
      const d = sub(b, a);
      const m = mid(a, b);
      const axisAligned = Math.abs(d[0]) <= MIN || Math.abs(d[1]) <= MIN;
      const s = dot(sub(cursor, a), d) / dot(d, d);
      const toCursor = sub(cursor, m);
      const byCursor: LinearKind =
        !axisAligned && s >= 0 && s <= 1
          ? 'distance'
          : Math.abs(toCursor[1]) > Math.abs(toCursor[0])
            ? 'hDistance'
            : 'vDistance';
      // An axis that measures zero (beside a horizontal line) gives way to the other one.
      const kind: LinearKind =
        byCursor === 'hDistance' && Math.abs(d[0]) <= MIN
          ? 'vDistance'
          : byCursor === 'vDistance' && Math.abs(d[1]) <= MIN
            ? 'hDistance'
            : byCursor;
      const draft = withValue({ kind, a: target.a, b: target.b, value: 0 }, data);
      if (draft === null) return null;
      return { ...draft, placement: linearPlacement(linearFrame(kind, a, b), cursor) };
    }
    case 'pointLine': {
      const frame = pointLineFrame(geo, target.point, target.line);
      if (frame === null) return null;
      const draft = withValue(
        { kind: 'pointLineDistance', point: target.point, line: target.line, value: 0 },
        data,
      );
      if (draft === null) return null;
      return { ...draft, placement: linearPlacement(frame, cursor) };
    }
    case 'round': {
      const { center, radius } = geo.round(target.curve);
      const placement = radialPlacement(center, cursor);
      if (placement === null) return null;
      const kind = placement.distance < radius ? 'radius' : 'diameter';
      const draft = withValue({ kind, curve: target.curve, value: 0 }, data);
      if (draft === null) return null;
      return { ...draft, placement };
    }
    case 'lines': {
      const frame = angleFrame(geo, target.a, target.b);
      if (frame === null) return null;
      const w = sub(cursor, frame.vertex);
      if (len(w) <= MIN) return null;
      // w = α·d_a + β·d_b (Cramer's rule); the signs pick the quadrant.
      const det = cross(frame.da, frame.db);
      const alpha = cross(w, frame.db) / det;
      const beta = cross(frame.da, w) / det;
      const reverseA: { reverseA?: true } = alpha < 0 ? { reverseA: true } : {};
      const reverseB: { reverseB?: true } = beta < 0 ? { reverseB: true } : {};
      const draft = withValue(
        { kind: 'angle', a: target.a, b: target.b, value: 0, ...reverseA, ...reverseB },
        data,
      );
      if (draft === null) return null;
      return { ...draft, placement: angularPlacement(frame, draft, draft.value, cursor) };
    }
    default:
      return assertNever(target);
  }
}

/**
 * The new placement of an existing dimension for the cursor; the kind, value and flags stay. A
 * degenerate cursor (the vertex, the centre) keeps the current placement (stored or default).
 */
export function movePlacement(
  c: DimensionConstraint,
  cursor: Vec2,
  data: SketchData,
): DimensionPlacement {
  const current = (): DimensionPlacement => c.placement ?? defaultPlacement(c, data);
  const geo = geometry(data);
  switch (c.kind) {
    case 'distance':
    case 'hDistance':
    case 'vDistance':
      return linearPlacement(linearFrame(c.kind, geo.point(c.a), geo.point(c.b)), cursor);
    case 'pointLineDistance': {
      const frame = pointLineFrame(geo, c.point, c.line);
      return frame === null ? current() : linearPlacement(frame, cursor);
    }
    case 'radius':
    case 'diameter':
      return radialPlacement(geo.round(c.curve).center, cursor) ?? current();
    case 'angle': {
      const frame = angleFrame(geo, c.a, c.b);
      if (frame === null || len(sub(cursor, frame.vertex)) <= MIN) return current();
      const value = measureDraft(data, c);
      return value <= MIN ? current() : angularPlacement(frame, c, value, cursor);
    }
    default:
      return assertNever(c);
  }
}

/**
 * The placement a dimension without `placement` uses, in mm (proportional to the geometry, since
 * a pure function does not know the zoom). Linear: offset ±0.2 · value on the +y side (a vertical
 * distance on the left), along 0; radial: π/4 or the middle of the arc, 1.25 · radius; angular:
 * half the shorter line (1 mm for a zero-length one), t 0.5.
 */
export function defaultPlacement(c: DimensionConstraint, data: SketchData): DimensionPlacement {
  const geo = geometry(data);
  switch (c.kind) {
    case 'distance': {
      const d = sub(geo.point(c.b), geo.point(c.a));
      // n = (−u.y, u.x): left of a→b is +y when a→b goes right; a vertical one goes left when up.
      const positive = Math.abs(d[0]) <= MIN ? d[1] > 0 : d[0] > 0;
      const offset = 0.2 * measureDraft(data, c);
      return { kind: 'linear', offset: positive ? offset : -offset, along: 0 };
    }
    case 'hDistance':
    case 'vDistance':
    case 'pointLineDistance': {
      const value = measureDraft(data, c);
      // A zero-length line measures NaN: offset 0 keeps the stored placement valid.
      return { kind: 'linear', offset: Number.isFinite(value) ? 0.2 * value : 0, along: 0 };
    }
    case 'radius':
    case 'diameter': {
      const { radius, angle } = geo.round(c.curve);
      return { kind: 'radial', angle, distance: 1.25 * radius };
    }
    case 'angle': {
      const lengthOf = (id: SketchEntityId) => {
        const [p1, p2] = geo.line(id);
        return len(sub(p2, p1));
      };
      const radius = 0.5 * Math.min(lengthOf(c.a), lengthOf(c.b));
      // A zero-length line would give radius 0, which parseSketchData rejects once stored.
      return { kind: 'angular', radius: radius > MIN ? radius : 1, t: 0.5 };
    }
    default:
      return assertNever(c);
  }
}

/** The draft with its measured value, or null when the value is degenerate. */
function withValue<D extends DimensionDraft>(draft: D, data: SketchData): D | null {
  const value = measureDraft(data, draft);
  return value > MIN ? { ...draft, value } : null;
}

/** The measured direction u (unit) and the middle m of a linear dimension. */
interface LinearFrame {
  readonly u: Vec2;
  readonly m: Vec2;
}

/** offset = (c − m)·n with n = (−u.y, u.x), along = (c − m)·u. */
function linearPlacement(frame: LinearFrame, cursor: Vec2): LinearPlacement {
  const { u, m } = frame;
  const w = sub(cursor, m);
  return { kind: 'linear', offset: dot(w, [-u[1], u[0]]), along: dot(w, u) };
}

function linearFrame(kind: LinearKind, a: Vec2, b: Vec2): LinearFrame {
  switch (kind) {
    case 'distance':
      return { u: direction(a, b), m: mid(a, b) };
    case 'hDistance':
      return { u: [1, 0], m: mid(a, b) };
    case 'vDistance':
      return { u: [0, 1], m: mid(a, b) };
    default:
      return assertNever(kind);
  }
}

/** A = the foot of the perpendicular from the point on the line, B = the point; null for a zero-length line. */
function pointLineFrame(
  geo: Geometry,
  pointId: SketchEntityId,
  lineId: SketchEntityId,
): LinearFrame | null {
  const p = geo.point(pointId);
  const [p1, p2] = geo.line(lineId);
  const d = sub(p2, p1);
  const dd = dot(d, d);
  if (Math.sqrt(dd) <= MIN) return null;
  const s = dot(sub(p, p1), d) / dd;
  const foot: Vec2 = [p1[0] + s * d[0], p1[1] + s * d[1]];
  return { u: direction(foot, p), m: mid(foot, p) };
}

/** angle = atan2(c − centre), distance = |c − centre|; null at the centre. */
function radialPlacement(center: Vec2, cursor: Vec2): RadialPlacement | null {
  const w = sub(cursor, center);
  const distance = len(w);
  if (distance <= MIN) return null;
  return { kind: 'radial', angle: Math.atan2(w[1], w[0]), distance };
}

/** The intersection of the lines and their directions p1→p2. */
interface AngleFrame {
  readonly vertex: Vec2;
  readonly da: Vec2;
  readonly db: Vec2;
}

/** null for parallel lines (or a zero-length one). */
function angleFrame(geo: Geometry, a: SketchEntityId, b: SketchEntityId): AngleFrame | null {
  const [a1, a2] = geo.line(a);
  const [b1, b2] = geo.line(b);
  const da = sub(a2, a1);
  const db = sub(b2, b1);
  const det = cross(da, db);
  if (Math.abs(det) <= MIN * len(da) * len(db)) return null;
  const s = cross(sub(b1, a1), db) / det;
  return { vertex: [a1[0] + s * da[0], a1[1] + s * da[1]], da, db };
}

/**
 * radius = |w|; t = the angle from ray A to w in the direction towards ray B, divided by the
 * measured angle `value`, clipped to [0, 1]. The rays are ±d by the flags.
 */
function angularPlacement(
  frame: AngleFrame,
  flags: { readonly reverseA?: true; readonly reverseB?: true },
  value: number,
  cursor: Vec2,
): AngularPlacement {
  const w = sub(cursor, frame.vertex);
  const rayA = scale(frame.da, flags.reverseA === true ? -1 : 1);
  const rayB = scale(frame.db, flags.reverseB === true ? -1 : 1);
  const towardsB = Math.sign(cross(rayA, rayB));
  const swept = Math.atan2(towardsB * cross(rayA, w), dot(rayA, w));
  return { kind: 'angular', radius: len(w), t: Math.min(1, Math.max(0, swept / value)) };
}

/** Coordinates of the referenced entities; a missing or wrong entity is a programming error. */
interface Geometry {
  point(id: SketchEntityId): Vec2;
  line(id: SketchEntityId): readonly [Vec2, Vec2];
  /** Centre, radius and the default label angle (π/4 for a circle, the middle of an arc). */
  round(id: SketchEntityId): {
    readonly center: Vec2;
    readonly radius: number;
    readonly angle: number;
  };
}

function geometry(data: SketchData): Geometry {
  const points = pointsById(data);
  const entity = (id: SketchEntityId) => data.entities.find((e) => e.id === id);
  const point = (id: SketchEntityId): Vec2 => {
    const p = points.get(id);
    assert(p !== undefined, `dimension placement: missing point '${id}'`);
    return [p.x, p.y];
  };
  return {
    point,
    line(id) {
      const l = entity(id);
      assert(l?.kind === 'line', `dimension placement: '${id}' is not a line`);
      return [point(l.p1), point(l.p2)];
    },
    round(id) {
      const curve = entity(id);
      assert(
        curve?.kind === 'circle' || curve?.kind === 'arc',
        `dimension placement: '${id}' is not round`,
      );
      const center = point(curve.center);
      if (curve.kind === 'circle') return { center, radius: curve.radius, angle: Math.PI / 4 };
      const start = sub(point(curve.start), center);
      const end = sub(point(curve.end), center);
      const from = Math.atan2(start[1], start[0]);
      let sweep = Math.atan2(end[1], end[0]) - from;
      if (sweep <= 0) sweep += 2 * Math.PI;
      const middle = from + sweep / 2;
      return { center, radius: len(start), angle: Math.atan2(Math.sin(middle), Math.cos(middle)) };
    },
  };
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The unit direction a→b; (1, 0) for a zero length (spec 12). */
function direction(a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const l = len(d);
  return l <= MIN ? [1, 0] : scale(d, 1 / l);
}
