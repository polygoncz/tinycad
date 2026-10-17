// The dimensions of the edited sketch for the viewport (spec 10, "SketchState"; spec 12, "Kóty
// (M28)", "Kresba"): what a dimension measures, where it stands (its placement, stored or default)
// and the world points to draw it from. ui projects the points and adds the arrows and the text.

import { plane as planeMath } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import { defaultPlacement, isDimension, isLineCarrier } from '@/sketch';
import type {
  AngularPlacement,
  DimensionConstraint,
  DimensionKind,
  DimensionPlacement,
  LinearPlacement,
  RadialPlacement,
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchItemId,
  SketchPoint,
} from '@/sketch';

/** Where a dimension is drawn, in world coordinates (spec 12, "Kresba"). */
export type DimensionGeometry =
  /**
   * Extension lines from→lineFrom and to→lineTo, the dimension line lineFrom–lineTo; label = the
   * point on the dimension line moved by `along` (outside the segment ui extends the line to it).
   */
  | {
      readonly kind: 'linear';
      readonly from: Vec3;
      readonly to: Vec3;
      readonly lineFrom: Vec3;
      readonly lineTo: Vec3;
      readonly label: Vec3;
    }
  /**
   * near = the point on the curve in the direction `angle`; far = the opposite point (only a
   * diameter, the line runs through the centre); label at `distance` from the centre.
   */
  | {
      readonly kind: 'radial';
      readonly center: Vec3;
      readonly near: Vec3;
      readonly far: Vec3 | null;
      readonly label: Vec3;
    }
  /** arc = points of the dimension arc (sampled, 33 points) from ray A to ray B; label at t. */
  | {
      readonly kind: 'angular';
      readonly vertex: Vec3;
      readonly arc: readonly Vec3[];
      readonly label: Vec3;
    };

export interface SketchDimensionView {
  readonly id: SketchConstraintId;
  readonly kind: DimensionKind;
  /** The exact value of the constraint (an angle in radians); ui rounds it. */
  readonly value: number;
  /** Order within its kind like SketchConstraintRow.n ("Distance 1"); 0 for the preview. */
  readonly n: number;
  readonly selected: boolean;
  /** The dimension hanging on the cursor of the dimension tool, not in the data yet. */
  readonly preview?: true;
  /** The stored placement, or defaultPlacement when the constraint has none. */
  readonly placement: DimensionPlacement;
  readonly geometry: DimensionGeometry;
}

/** The id of the preview view (SketchSession.previewDimension); never an id of the data. */
// A fixed id outside the generated ones ('__' never starts a minted id), hence the cast.
export const PREVIEW_DIMENSION_ID = '__preview' as SketchConstraintId;

/** Points of the sampled arc of an angular dimension. */
const ARC_POINTS = 33;
/** Below this a length is degenerate, like in sketch (spec 12). */
const MIN = 1e-9;

/**
 * The number of each constraint within its kind, from 1 in the order of `constraints` ("Distance
 * 2" is the second distance). The one numbering of the panel rows (SketchConstraintRow.n) and of
 * the dimensions in the view (SketchDimensionView.n), so a label and its row always agree.
 */
export function constraintNumbers(constraints: readonly SketchConstraint[]): readonly number[] {
  const counts = new Map<SketchConstraint['kind'], number>();
  return constraints.map((c) => {
    const n = (counts.get(c.kind) ?? 0) + 1;
    counts.set(c.kind, n);
    return n;
  });
}

/**
 * The views of the dimensions in their order, then the preview (a dimension draft) if any. A
 * dimension whose geometry cannot be computed (a missing entity, a radius on something else than
 * a circle or an arc, parallel lines of an angle) is left out. An unchanged item stays the same
 * object from `prev`, an unchanged result the same array.
 */
export function dimensionViews(
  plane: Plane,
  entities: readonly SketchEntity[],
  constraints: readonly SketchConstraint[],
  selection: readonly SketchItemId[],
  prev: readonly SketchDimensionView[],
  preview: SketchConstraintDraft | null = null,
): readonly SketchDimensionView[] {
  const data: SketchData = { entities, constraints };
  const byId = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));
  const old = new Map<string, SketchDimensionView>(prev.map((d) => [d.id, d]));
  // Numbered like the panel rows: every constraint of the kind counts, even a skipped one.
  const numbers = constraintNumbers(constraints);
  const views: SketchDimensionView[] = [];
  const push = (view: SketchDimensionView): void => {
    const before = old.get(view.id);
    views.push(before !== undefined && sameView(before, view) ? before : Object.freeze(view));
  };
  for (const [i, c] of constraints.entries()) {
    if (!isDimension(c)) continue;
    const drawn = drawnDimension(plane, data, byId, c);
    if (drawn === null) continue;
    push({
      id: c.id,
      kind: c.kind,
      value: c.value,
      n: numbers[i] ?? 0,
      selected: selection.includes(c.id),
      ...drawn,
    });
  }
  if (preview !== null && isDimension(preview)) {
    const c: DimensionConstraint = { ...preview, id: PREVIEW_DIMENSION_ID };
    const drawn = drawnDimension(plane, data, byId, c);
    if (drawn !== null) {
      push({
        id: c.id,
        kind: c.kind,
        value: c.value,
        n: 0,
        selected: false,
        preview: true,
        ...drawn,
      });
    }
  }
  const unchanged = views.length === prev.length && views.every((v, i) => v === prev[i]);
  return unchanged ? prev : Object.freeze(views);
}

type Entities = ReadonlyMap<string, SketchEntity>;

/** The placement (stored or default) and the geometry, or null when it cannot be computed. */
function drawnDimension(
  plane: Plane,
  data: SketchData,
  byId: Entities,
  c: DimensionConstraint,
): { readonly placement: DimensionPlacement; readonly geometry: DimensionGeometry } | null {
  const shape = shapeOf(byId, c);
  // defaultPlacement reads the referenced entities: only once they are known to exist.
  if (shape === null) return null;
  const placement = c.placement ?? defaultPlacement(c, data);
  const geometry = geometryOf(plane, shape, c, placement);
  return geometry === null ? null : { placement, geometry };
}

/** The plane geometry a dimension is laid out from. */
type Shape =
  /** The measured direction u (unit) from A to B, and the middle m of the measured span. */
  | {
      readonly kind: 'linear';
      readonly a: Vec2;
      readonly b: Vec2;
      readonly u: Vec2;
      readonly m: Vec2;
    }
  | { readonly kind: 'radial'; readonly center: Vec2; readonly radius: number }
  /** The directions p1→p2 of the lines and their intersection. */
  | { readonly kind: 'angular'; readonly vertex: Vec2; readonly da: Vec2; readonly db: Vec2 };

function shapeOf(byId: Entities, c: DimensionConstraint): Shape | null {
  switch (c.kind) {
    case 'distance':
    case 'hDistance':
    case 'vDistance': {
      const a = pointOf(byId, c.a);
      const b = pointOf(byId, c.b);
      if (a === null || b === null) return null;
      const u: Vec2 =
        c.kind === 'distance' ? direction(a, b) : c.kind === 'hDistance' ? [1, 0] : [0, 1];
      return { kind: 'linear', a, b, u, m: mid(a, b) };
    }
    case 'pointLineDistance':
      return pointLineShape(byId, c.point, c.line);
    case 'offset':
      return offsetShape(byId, c);
    case 'radius':
    case 'diameter':
      return roundOf(byId, c.curve);
    case 'angle': {
      const a = lineOf(byId, c.a);
      const b = lineOf(byId, c.b);
      if (a === null || b === null) return null;
      const da = sub(a[1], a[0]);
      const db = sub(b[1], b[0]);
      const det = cross(da, db);
      // Parallel lines (or a zero-length one) have no vertex.
      if (Math.abs(det) <= MIN * len(da) * len(db) || len(da) <= MIN || len(db) <= MIN) return null;
      const s = cross(sub(b[0], a[0]), db) / det;
      return { kind: 'angular', vertex: add(a[0], scale(da, s)), da, db };
    }
  }
}

/** From the foot of the perpendicular on the line (A) to the point (B); null for a zero-length line. */
function pointLineShape(byId: Entities, pointId: string, lineId: string): Shape | null {
  const p = pointOf(byId, pointId);
  const line = lineOf(byId, lineId);
  if (p === null || line === null) return null;
  const d = sub(line[1], line[0]);
  // A zero-length line has no foot of the perpendicular.
  if (len(d) <= MIN) return null;
  const foot = add(line[0], scale(d, dot(sub(p, line[0]), d) / dot(d, d)));
  return { kind: 'linear', a: foot, b: p, u: direction(foot, p), m: mid(foot, p) };
}

/**
 * An offset dimension on its first pair (spec 12, "Offset (M35)"), like offsetFrame of sketch: a
 * line pair from the foot of the perpendicular of copy.p1 on the source line to copy.p1; a round
 * pair along the ray from the centre at the default label angle of the source (π/4 for a circle,
 * the middle of an arc), from the point on the source to the point on the copy.
 */
function offsetShape(
  byId: Entities,
  c: Extract<DimensionConstraint, { kind: 'offset' }>,
): Shape | null {
  const [pair] = c.pairs;
  if (pair === undefined) return null;
  const copy = byId.get(pair.copy);
  if (copy?.kind === 'line') return pointLineShape(byId, copy.p1, pair.source);
  const source = roundOf(byId, pair.source);
  const angle = labelAngle(byId, pair.source);
  const copyRound = roundOf(byId, pair.copy);
  if (source === null || angle === null || copyRound === null) return null;
  const ray: Vec2 = [Math.cos(angle), Math.sin(angle)];
  const a = add(source.center, scale(ray, source.radius));
  const b = add(source.center, scale(ray, copyRound.radius));
  return {
    kind: 'linear',
    a,
    b,
    u: copyRound.radius < source.radius ? scale(ray, -1) : ray,
    m: mid(a, b),
  };
}

/** The default label angle of a circle (π/4) or an arc (the middle of its counter-clockwise sweep). */
function labelAngle(byId: Entities, id: string): number | null {
  const entity = byId.get(id);
  if (entity?.kind === 'circle') return Math.PI / 4;
  if (entity?.kind !== 'arc') return null;
  const center = pointOf(byId, entity.center);
  const start = pointOf(byId, entity.start);
  const end = pointOf(byId, entity.end);
  if (center === null || start === null || end === null) return null;
  const s = sub(start, center);
  const e = sub(end, center);
  const from = Math.atan2(s[1], s[0]);
  let sweep = Math.atan2(e[1], e[0]) - from;
  if (sweep <= 0) sweep += 2 * Math.PI;
  const middle = from + sweep / 2;
  return Math.atan2(Math.sin(middle), Math.cos(middle));
}

/** The geometry in world coordinates; null when the placement does not fit the shape. */
function geometryOf(
  plane: Plane,
  shape: Shape,
  c: DimensionConstraint,
  placement: DimensionPlacement,
): DimensionGeometry | null {
  const world = (v: Vec2): Vec3 => planeMath.toWorld(plane, v);
  if (shape.kind === 'linear' && placement.kind === 'linear') {
    const g = linearGeometry(shape, placement);
    return {
      kind: 'linear',
      from: world(shape.a),
      to: world(shape.b),
      lineFrom: world(g.lineFrom),
      lineTo: world(g.lineTo),
      label: world(g.label),
    };
  }
  if (shape.kind === 'radial' && placement.kind === 'radial') {
    const g = radialGeometry(shape, placement, c.kind === 'diameter');
    return {
      kind: 'radial',
      center: world(shape.center),
      near: world(g.near),
      far: g.far === null ? null : world(g.far),
      label: world(g.label),
    };
  }
  if (shape.kind === 'angular' && placement.kind === 'angular' && c.kind === 'angle') {
    const g = angularGeometry(shape, placement, c);
    return {
      kind: 'angular',
      vertex: world(shape.vertex),
      arc: g.arc.map(world),
      label: world(g.label),
    };
  }
  // parseSketchData pairs the placement with the kind; other data is not drawn.
  return null;
}

/**
 * With n = (−u.y, u.x): lineFrom = A + ((m − A)·n + offset)·n, lineTo = B + ((m − B)·n +
 * offset)·n, label = m + offset·n + along·u.
 */
function linearGeometry(
  shape: Extract<Shape, { kind: 'linear' }>,
  p: LinearPlacement,
): { readonly lineFrom: Vec2; readonly lineTo: Vec2; readonly label: Vec2 } {
  const { a, b, u, m } = shape;
  const n: Vec2 = [-u[1], u[0]];
  const onLine = (q: Vec2): Vec2 => add(q, scale(n, dot(sub(m, q), n) + p.offset));
  return {
    lineFrom: onLine(a),
    lineTo: onLine(b),
    label: add(m, add(scale(n, p.offset), scale(u, p.along))),
  };
}

/** near = centre + r·(cos, sin) of angle, far = centre − r·(…) for a diameter, label at distance. */
function radialGeometry(
  shape: Extract<Shape, { kind: 'radial' }>,
  p: RadialPlacement,
  diameter: boolean,
): { readonly near: Vec2; readonly far: Vec2 | null; readonly label: Vec2 } {
  const dir: Vec2 = [Math.cos(p.angle), Math.sin(p.angle)];
  return {
    near: add(shape.center, scale(dir, shape.radius)),
    far: diameter ? add(shape.center, scale(dir, -shape.radius)) : null,
    label: add(shape.center, scale(dir, p.distance)),
  };
}

/**
 * The arc of radius `radius` around the vertex from ray A to ray B (±d by the flags) the shorter
 * way, sampled in 33 points; the label on it at t.
 */
function angularGeometry(
  shape: Extract<Shape, { kind: 'angular' }>,
  p: AngularPlacement,
  c: Extract<DimensionConstraint, { kind: 'angle' }>,
): { readonly arc: readonly Vec2[]; readonly label: Vec2 } {
  const rayA = scale(shape.da, c.reverseA === true ? -1 : 1);
  const rayB = scale(shape.db, c.reverseB === true ? -1 : 1);
  const from = Math.atan2(rayA[1], rayA[0]);
  // Signed, in (−π, π]: the shorter way from A to B.
  const sweep = Math.atan2(cross(rayA, rayB), dot(rayA, rayB));
  const at = (k: number): Vec2 => {
    const angle = from + sweep * k;
    return add(shape.vertex, [p.radius * Math.cos(angle), p.radius * Math.sin(angle)]);
  };
  const arc = Array.from({ length: ARC_POINTS }, (_, i) => at(i / (ARC_POINTS - 1)));
  return { arc, label: at(p.t) };
}

function pointOf(byId: Entities, id: string): Vec2 | null {
  const entity = byId.get(id);
  return entity?.kind === 'point' ? xy(entity) : null;
}

/** p1 and p2 of a line or an xline (M31: dimensions measure to its carrier line). */
function lineOf(byId: Entities, id: string): readonly [Vec2, Vec2] | null {
  const entity = byId.get(id);
  if (entity === undefined || !isLineCarrier(entity)) return null;
  const p1 = pointOf(byId, entity.p1);
  const p2 = pointOf(byId, entity.p2);
  return p1 === null || p2 === null ? null : [p1, p2];
}

/** The centre and the radius of a circle or an arc (|start − centre|). */
function roundOf(byId: Entities, id: string): Extract<Shape, { kind: 'radial' }> | null {
  const entity = byId.get(id);
  if (entity?.kind === 'circle') {
    const center = pointOf(byId, entity.center);
    return center === null ? null : { kind: 'radial', center, radius: entity.radius };
  }
  if (entity?.kind === 'arc') {
    const center = pointOf(byId, entity.center);
    const start = pointOf(byId, entity.start);
    // defaultPlacement reads the end of an arc too.
    if (center === null || start === null || pointOf(byId, entity.end) === null) return null;
    return { kind: 'radial', center, radius: len(sub(start, center)) };
  }
  return null;
}

const xy = (p: SketchPoint): Vec2 => [p.x, p.y];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
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

function sameView(a: SketchDimensionView, b: SketchDimensionView): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    Object.is(a.value, b.value) &&
    a.n === b.n &&
    a.selected === b.selected &&
    a.preview === b.preview &&
    samePlacement(a.placement, b.placement) &&
    sameGeometry(a.geometry, b.geometry)
  );
}

/** Placements are flat objects of primitives. */
function samePlacement(a: DimensionPlacement, b: DimensionPlacement): boolean {
  const own = Object.entries(a);
  const other = new Map<string, unknown>(Object.entries(b));
  return own.length === other.size && own.every(([k, v]) => Object.is(v, other.get(k)));
}

function sameGeometry(a: DimensionGeometry, b: DimensionGeometry): boolean {
  switch (a.kind) {
    case 'linear':
      return (
        b.kind === 'linear' &&
        sameVec(a.from, b.from) &&
        sameVec(a.to, b.to) &&
        sameVec(a.lineFrom, b.lineFrom) &&
        sameVec(a.lineTo, b.lineTo) &&
        sameVec(a.label, b.label)
      );
    case 'radial':
      return (
        b.kind === 'radial' &&
        sameVec(a.center, b.center) &&
        sameVec(a.near, b.near) &&
        (a.far === null || b.far === null ? a.far === b.far : sameVec(a.far, b.far)) &&
        sameVec(a.label, b.label)
      );
    case 'angular':
      return (
        b.kind === 'angular' &&
        sameVec(a.vertex, b.vertex) &&
        a.arc.length === b.arc.length &&
        a.arc.every((p, i) => {
          const q = b.arc[i];
          return q !== undefined && sameVec(p, q);
        }) &&
        sameVec(a.label, b.label)
      );
  }
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.every((v, i) => Object.is(v, b[i]));
