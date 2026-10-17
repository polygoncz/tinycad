import { err, ok } from '@/core';
import type { Result } from '@/core';
import { isDimensionKind, patternParamsValid } from './model';
import type { DimensionKind, DimensionPlacement, SketchData, SketchPattern } from './model';

// Shape and invariant checks of sketch data (spec 12 "Kontrola dat"). The only trusted place
// where raw params become typed SketchData: ids are branded here, nowhere else.

export interface SketchIssue {
  readonly path: 'entities' | 'constraints';
  readonly index: number;
  readonly code: 'sketch.invalidEntity' | 'sketch.invalidConstraint';
}

/** Relative tolerance of equal arc radii and the smallest arc radius (spec 12). */
const ARC_RADIUS_TOLERANCE = 1e-6;
const MIN_ARC_RADIUS = 1e-9;

type Fields = Readonly<Record<string, unknown>>;

/** Required and optional fields of each entity kind, besides `kind`. */
const ENTITY_FIELDS: Readonly<Record<string, { required: string[]; optional: string[] }>> = {
  point: { required: ['id', 'x', 'y'], optional: [] },
  line: { required: ['id', 'p1', 'p2'], optional: ['construction'] },
  circle: { required: ['id', 'center', 'radius'], optional: ['construction'] },
  arc: { required: ['id', 'center', 'start', 'end'], optional: ['construction'] },
  bspline: { required: ['id', 'degree', 'poles', 'knots'], optional: ['construction'] },
  fitSpline: {
    required: ['id', 'degree', 'fit', 'params', 'poles', 'knots'],
    optional: ['construction'],
  },
  // Always construction (M31): the flag is required and must be true.
  xline: { required: ['id', 'p1', 'p2', 'construction'], optional: [] },
  mirror: { required: ['id', 'sources', 'axis'], optional: [] },
  linearPattern: { required: ['id', 'sources', 'direction1'], optional: ['direction2'] },
  circularPattern: { required: ['id', 'sources', 'center', 'count', 'angle'], optional: [] },
};

/** The entity kinds of mirrors and patterns (M36): recipes, no constraint may refer to them. */
const PATTERN = new Set(['mirror', 'linearPattern', 'circularPattern']);

/** The highest spline degree (cubic); a spline's degree = min(MAX_SPLINE_DEGREE, points − 1). */
const MAX_SPLINE_DEGREE = 3;

/**
 * Entity kind groups a constraint field may refer to: `line` a line with its length and ends,
 * `carrier` a line or an xline taken as its infinite carrier line (M31).
 */
type Target = 'point' | 'line' | 'carrier' | 'round' | 'curve';
const ROUND = new Set(['circle', 'arc']);
const CARRIER = new Set(['line', 'xline']);
/** pointOnCurve may lie on any curve, a spline (M29) and an xline (M31) too. */
const CURVE = new Set(['line', 'circle', 'arc', 'bspline', 'fitSpline', 'xline']);

/**
 * The fields of each curve kind that refer to its defining points (curvePoints on raw data); a
 * spline field is a list of point ids (the poles of a fitSpline are coordinates, its points `fit`).
 */
const DEFINING_POINT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  line: ['p1', 'p2'],
  circle: ['center'],
  arc: ['center', 'start', 'end'],
  bspline: ['poles'],
  fitSpline: ['fit'],
  xline: ['p1', 'p2'],
};

/**
 * Fields of each constraint kind besides `kind` and `id`; a ref field lists the entity kind it
 * needs. Pair kinds (equal, tangent) need an extra rule on the combination, see pairAllowed;
 * pointOnCurve and midpoint one on the point, see definesCurve; `pairs` (offset, M35) is a list
 * of curve pairs, see offsetPairsValid.
 */
const CONSTRAINT_FIELDS: Readonly<
  Record<string, Readonly<Record<string, Target | 'value' | 'pairs'>>>
> = {
  coincident: { a: 'point', b: 'point' },
  horizontal: { line: 'carrier' },
  vertical: { line: 'carrier' },
  parallel: { a: 'carrier', b: 'carrier' },
  perpendicular: { a: 'carrier', b: 'carrier' },
  equal: { a: 'line', b: 'line' },
  tangent: { a: 'line', b: 'line' },
  pointOnCurve: { point: 'point', curve: 'curve' },
  midpoint: { point: 'point', line: 'line' },
  hAlign: { a: 'point', b: 'point' },
  vAlign: { a: 'point', b: 'point' },
  symmetric: { a: 'point', b: 'point', axis: 'line' },
  fix: { point: 'point' },
  distance: { a: 'point', b: 'point', value: 'value' },
  hDistance: { a: 'point', b: 'point', value: 'value' },
  vDistance: { a: 'point', b: 'point', value: 'value' },
  pointLineDistance: { point: 'point', line: 'carrier', value: 'value' },
  angle: { a: 'carrier', b: 'carrier', value: 'value' },
  radius: { curve: 'round', value: 'value' },
  diameter: { curve: 'round', value: 'value' },
  offset: { pairs: 'pairs', value: 'value' },
};

/** The placement kind of each dimension kind (spec 12 "Kóty (M28)"); placement is optional. */
const PLACEMENT_KIND: Readonly<Record<DimensionKind, DimensionPlacement['kind']>> = {
  distance: 'linear',
  hDistance: 'linear',
  vDistance: 'linear',
  pointLineDistance: 'linear',
  angle: 'angular',
  radius: 'radial',
  diameter: 'radial',
  offset: 'linear',
};

/** Optional flags of an angle: absent or `true`, like `construction`. */
const ANGLE_FLAGS = ['reverseA', 'reverseB'];

/** Ok = the same values typed (the trusted place instead of casting ids). Reports every problem. */
export function parseSketchData(
  entities: unknown,
  constraints: unknown,
): Result<SketchData, readonly SketchIssue[]> {
  const issues: SketchIssue[] = [];
  const entityIssue = (index: number) =>
    issues.push({ path: 'entities', index, code: 'sketch.invalidEntity' });
  const constraintIssue = (index: number) =>
    issues.push({ path: 'constraints', index, code: 'sketch.invalidConstraint' });

  const entityItems = Array.isArray(entities) ? (entities as readonly unknown[]) : undefined;
  const constraintItems = Array.isArray(constraints)
    ? (constraints as readonly unknown[])
    : undefined;
  if (entityItems === undefined) entityIssue(-1);

  // References may point to later entities, so the targets are collected first:
  // id → the first entity with that id (a duplicate is reported at itself).
  const targets = new Map<string, Fields>();
  for (const item of entityItems ?? []) {
    if (isRecord(item) && isId(item.id) && !targets.has(item.id)) targets.set(item.id, item);
  }

  const used = new Set<string>();
  for (const [index, item] of (entityItems ?? []).entries()) {
    if (!entityValid(item, targets, used)) entityIssue(index);
  }

  if (constraintItems === undefined) constraintIssue(-1);
  for (const [index, item] of (constraintItems ?? []).entries()) {
    if (!constraintValid(item, targets, used)) constraintIssue(index);
  }

  if (issues.length > 0 || entityItems === undefined || constraintItems === undefined) {
    return err(issues);
  }
  // Every item passed the checks above, which mirror SketchData exactly.
  return ok({ entities: entityItems, constraints: constraintItems } as SketchData);
}

/** Checks one entity; registers its id in `used` (also an invalid one, so a later duplicate is caught). */
function entityValid(
  item: unknown,
  targets: ReadonlyMap<string, Fields>,
  used: Set<string>,
): boolean {
  if (!isRecord(item)) return false;
  const idFresh = claimId(item.id, used);
  const kind = item.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(ENTITY_FIELDS, kind)) return false;
  const fields = ENTITY_FIELDS[kind];
  if (fields === undefined || !hasExactly(item, fields.required, fields.optional)) return false;
  if (!idFresh) return false;
  if (Object.hasOwn(item, 'construction') && item.construction !== true) return false;
  const point = (ref: unknown): Fields | undefined => {
    if (typeof ref !== 'string') return undefined;
    const target = targets.get(ref);
    return target?.kind === 'point' ? target : undefined;
  };
  switch (kind) {
    case 'point':
      return isFiniteNumber(item.x) && isFiniteNumber(item.y);
    case 'line':
    case 'xline':
      return point(item.p1) !== undefined && point(item.p2) !== undefined && item.p1 !== item.p2;
    case 'circle':
      return point(item.center) !== undefined && isFiniteNumber(item.radius) && item.radius > 0;
    case 'arc': {
      const c = point(item.center);
      const s = point(item.start);
      const e = point(item.end);
      if (c === undefined || s === undefined || e === undefined) return false;
      if (new Set([item.center, item.start, item.end]).size !== 3) return false;
      return arcRadiiValid(c, s, e);
    }
    case 'bspline': {
      const n = splinePointCount(item.poles, point);
      if (n === undefined) return false;
      const degree = Math.min(MAX_SPLINE_DEGREE, n - 1);
      return item.degree === degree && knotsValid(item.knots, n, degree);
    }
    case 'fitSpline': {
      const n = splinePointCount(item.fit, point);
      if (n === undefined) return false;
      const degree = Math.min(MAX_SPLINE_DEGREE, n - 1);
      return (
        item.degree === degree &&
        paramsValid(item.params, n) &&
        polesValid(item.poles, n) &&
        knotsValid(item.knots, n, degree)
      );
    }
    case 'mirror': {
      const axis = typeof item.axis === 'string' ? targets.get(item.axis) : undefined;
      return patternValid(item, targets, item.axis) && axis?.kind === 'line';
    }
    case 'linearPattern':
      return (
        patternValid(item, targets, undefined) &&
        directionShape(item.direction1) &&
        (!Object.hasOwn(item, 'direction2') || directionShape(item.direction2)) &&
        patternValuesValid(item)
      );
    case 'circularPattern':
      return (
        patternValid(item, targets, item.center) &&
        point(item.center) !== undefined &&
        typeof item.count === 'number' &&
        typeof item.angle === 'number' &&
        patternValuesValid(item)
      );
    default:
      return false;
  }
}

/**
 * The common rules of a mirror or pattern (M36): its id and the ids of its sources have no `:` or
 * `,` (derived ids stay unambiguous); the sources are a non-empty list of distinct points or
 * curves of the sketch, without the axis or center (`anchor`).
 */
function patternValid(
  item: Fields,
  targets: ReadonlyMap<string, Fields>,
  anchor: unknown,
): boolean {
  if (!plainId(item.id) || !Array.isArray(item.sources) || item.sources.length === 0) return false;
  const sources = item.sources as readonly unknown[];
  if (new Set(sources).size !== sources.length || sources.includes(anchor)) return false;
  return sources.every((ref) => {
    if (!plainId(ref)) return false;
    const kind = targets.get(ref)?.kind;
    return kind === 'point' || (typeof kind === 'string' && CURVE.has(kind));
  });
}

/** An id usable in a derived id: no `:` and no `,`. */
function plainId(v: unknown): v is string {
  return isId(v) && !v.includes(':') && !v.includes(',');
}

/** The shape of a direction of a linear pattern: exactly angle, count and spacing, all numbers. */
function directionShape(v: unknown): boolean {
  return (
    isRecord(v) &&
    hasExactly(v, ['angle', 'count', 'spacing'], []) &&
    typeof v.angle === 'number' &&
    typeof v.count === 'number' &&
    typeof v.spacing === 'number'
  );
}

/** The values of the parameters of a pattern whose shape is checked (patternParamsValid). */
function patternValuesValid(item: Fields): boolean {
  // The caller checked the kind, the fields and that every parameter is a number, so the item
  // has the shape of a SketchPattern; patternParamsValid judges only the values.
  return patternParamsValid(item as unknown as SketchPattern);
}

/** |end − center| = |start − center| within the relative tolerance, radius not degenerate. */
function arcRadiiValid(center: Fields, start: Fields, end: Fields): boolean {
  const c = coordinates(center);
  const s = coordinates(start);
  const e = coordinates(end);
  // A point with bad coordinates is reported at itself; the arc cannot be judged.
  if (c === undefined || s === undefined || e === undefined) return true;
  const rStart = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const rEnd = Math.hypot(e[0] - c[0], e[1] - c[1]);
  return (
    rStart > MIN_ARC_RADIUS && Math.abs(rEnd - rStart) <= ARC_RADIUS_TOLERANCE * Math.max(1, rStart)
  );
}

/** The number of spline points when they are ≥ 2 distinct references to points, else undefined. */
function splinePointCount(
  refs: unknown,
  point: (ref: unknown) => Fields | undefined,
): number | undefined {
  if (!Array.isArray(refs) || refs.length < 2) return undefined;
  const items = refs as readonly unknown[];
  if (!items.every((ref) => point(ref) !== undefined)) return undefined;
  return new Set(items).size === items.length ? items.length : undefined;
}

/**
 * Clamped knots of n poles: length n + degree + 1, the first degree + 1 are 0, the last
 * degree + 1 are 1, the interior ones lie in (0, 1), do not decrease and none repeats more than
 * degree times.
 */
function knotsValid(knots: unknown, n: number, degree: number): boolean {
  if (!Array.isArray(knots) || knots.length !== n + degree + 1) return false;
  const values = knots as readonly unknown[];
  if (!values.every(isFiniteNumber)) return false;
  let run = 0;
  for (const [i, k] of values.entries()) {
    if (i <= degree) {
      if (k !== 0) return false;
    } else if (i >= n) {
      if (k !== 1) return false;
    } else {
      const previous = values[i - 1];
      if (k <= 0 || k >= 1 || previous === undefined || k < previous) return false;
      run = k === previous ? run + 1 : 1;
      if (run > degree) return false;
    }
  }
  return true;
}

/** n parameters, increasing, first 0, last 1. */
function paramsValid(params: unknown, n: number): boolean {
  if (!Array.isArray(params) || params.length !== n) return false;
  const values = params as readonly unknown[];
  if (!values.every(isFiniteNumber)) return false;
  return (
    values[0] === 0 &&
    values[n - 1] === 1 &&
    values.every((t, i) => {
      const previous = values[i - 1];
      return i === 0 || (previous !== undefined && t > previous);
    })
  );
}

/** n pairs of finite coordinates. */
function polesValid(poles: unknown, n: number): boolean {
  if (!Array.isArray(poles) || poles.length !== n) return false;
  return (poles as readonly unknown[]).every(
    (p) => Array.isArray(p) && p.length === 2 && (p as readonly unknown[]).every(isFiniteNumber),
  );
}

function coordinates(point: Fields): readonly [number, number] | undefined {
  const { x, y } = point;
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : undefined;
}

function constraintValid(
  item: unknown,
  targets: ReadonlyMap<string, Fields>,
  used: Set<string>,
): boolean {
  if (!isRecord(item)) return false;
  const idFresh = claimId(item.id, used);
  const kind = item.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(CONSTRAINT_FIELDS, kind)) return false;
  const fields = CONSTRAINT_FIELDS[kind];
  const placementKind = isDimensionKind(kind) ? PLACEMENT_KIND[kind] : undefined;
  const optional = [
    ...(placementKind === undefined ? [] : ['placement']),
    ...(kind === 'angle' ? ANGLE_FLAGS : []),
  ];
  if (fields === undefined || !hasExactly(item, ['id', ...Object.keys(fields)], optional)) {
    return false;
  }
  if (!idFresh) return false;
  if (ANGLE_FLAGS.some((flag) => Object.hasOwn(item, flag) && item[flag] !== true)) return false;
  if (Object.hasOwn(item, 'placement') && !placementValid(item.placement, placementKind)) {
    return false;
  }
  if (kind === 'angle' && !(isFiniteNumber(item.value) && item.value < Math.PI)) return false;

  const refKinds: string[] = [];
  const refs: unknown[] = [];
  const refTargets: Fields[] = [];
  for (const [field, need] of Object.entries(fields)) {
    const v = item[field];
    if (need === 'value') {
      if (!isFiniteNumber(v) || v <= 0) return false;
      continue;
    }
    if (need === 'pairs') {
      if (!offsetPairsValid(v, targets)) return false;
      continue;
    }
    const target = typeof v === 'string' ? targets.get(v) : undefined;
    const targetKind = target?.kind;
    if (typeof targetKind !== 'string') return false;
    refKinds.push(targetKind);
    refs.push(v);
    if (target !== undefined) refTargets.push(target);
  }
  if (refs.length === 2 && refs[0] === refs[1]) return false;
  // Mirrors and patterns are recipes: no constraint refers to them (M36).
  if (refKinds.some((k) => PATTERN.has(k))) return false;
  if (kind === 'tangent' && lineAtSplineEnd(refTargets)) return true;
  if (kind === 'equal' || kind === 'tangent') return pairAllowed(kind, refKinds);
  if (kind === 'pointLineDistance' && isEndOf(item.point, item.line, targets)) return false;
  const kindsMatch = Object.values(fields)
    .filter((need) => need !== 'value' && need !== 'pairs')
    .every((need, i) => matches(need, refKinds[i]));
  if (!kindsMatch) return false;
  if (kind === 'symmetric') {
    // Two different points, neither a point of the axis.
    const axis = typeof item.axis === 'string' ? targets.get(item.axis) : undefined;
    return (
      item.a !== item.b &&
      axis !== undefined &&
      !definesCurve(item.a, axis) &&
      !definesCurve(item.b, axis)
    );
  }
  if (kind === 'pointOnCurve' || kind === 'midpoint') {
    const [point, curve] = refs;
    const target = typeof curve === 'string' ? targets.get(curve) : undefined;
    return target !== undefined && !definesCurve(point, target);
  }
  return true;
}

/**
 * The pairs of an offset (M35): a non-empty list of { source, copy }; every curve at most once in
 * all pairs (so a copy is no source); line → line, arc → arc or circle → circle with the same
 * centre point. A spline has no pair (its offset is baked).
 */
function offsetPairsValid(v: unknown, targets: ReadonlyMap<string, Fields>): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  const seen = new Set<unknown>();
  return (v as readonly unknown[]).every((pair) => {
    if (!isRecord(pair) || !hasExactly(pair, ['source', 'copy'], [])) return false;
    const { source, copy } = pair;
    if (seen.has(source) || seen.has(copy) || source === copy) return false;
    seen.add(source);
    seen.add(copy);
    const s = typeof source === 'string' ? targets.get(source) : undefined;
    const c = typeof copy === 'string' ? targets.get(copy) : undefined;
    if (s === undefined || c === undefined || s.kind !== c.kind) return false;
    if (s.kind === 'line') return true;
    return (s.kind === 'arc' || s.kind === 'circle') && s.center === c.center;
  });
}

/** Whether the point id is one of the defining points of the (raw) curve. */
function definesCurve(point: unknown, curve: Fields): boolean {
  const fields = typeof curve.kind === 'string' ? DEFINING_POINT_FIELDS[curve.kind] : undefined;
  return (fields ?? []).some((field) => {
    const v = curve[field];
    return Array.isArray(v) ? v.includes(point) : v === point;
  });
}

/** A placement of the given kind with finite numbers in range and nothing else. */
function placementValid(v: unknown, kind: DimensionPlacement['kind'] | undefined): boolean {
  if (!isRecord(v) || v.kind !== kind) return false;
  switch (kind) {
    case 'linear':
      return (
        hasExactly(v, ['offset', 'along'], []) &&
        isFiniteNumber(v.offset) &&
        isFiniteNumber(v.along)
      );
    case 'radial':
      return (
        hasExactly(v, ['angle', 'distance'], []) &&
        isFiniteNumber(v.angle) &&
        isFiniteNumber(v.distance) &&
        v.distance > 0
      );
    case 'angular':
      return (
        hasExactly(v, ['radius', 't'], []) &&
        isFiniteNumber(v.radius) &&
        v.radius > 0 &&
        isFiniteNumber(v.t) &&
        v.t >= 0 &&
        v.t <= 1
      );
    default:
      return false;
  }
}

/** True when the point is p1 or p2 of the line or the xline. */
function isEndOf(point: unknown, line: unknown, targets: ReadonlyMap<string, Fields>): boolean {
  const target = typeof line === 'string' ? targets.get(line) : undefined;
  return target !== undefined && (target.p1 === point || target.p2 === point);
}

/**
 * equal: two lines or two rounds (an xline has no length); tangent: a line or an xline and a
 * round (any order) or two rounds.
 */
function pairAllowed(kind: 'equal' | 'tangent', [a, b]: readonly string[]): boolean {
  const rounds = [a, b].filter((k) => k !== undefined && ROUND.has(k)).length;
  if (kind === 'equal') return (a === 'line' && b === 'line') || rounds === 2;
  const carriers = [a, b].filter((k) => k !== undefined && CARRIER.has(k)).length;
  return rounds === 2 || (carriers === 1 && rounds === 1);
}

/**
 * tangent (M29): a line and a spline (either order) where the line shares a point with an end of
 * the spline (the first or last pole of a bspline, fit point of a fitSpline).
 */
function lineAtSplineEnd(pair: readonly Fields[]): boolean {
  const line = pair.find((t) => t.kind === 'line');
  const spline = pair.find((t) => t.kind === 'bspline' || t.kind === 'fitSpline');
  if (pair.length !== 2 || line === undefined || spline === undefined) return false;
  const points = spline.kind === 'bspline' ? spline.poles : spline.fit;
  // The spline itself is checked as an entity; a malformed one cannot be judged here.
  if (!Array.isArray(points) || points.length === 0) return false;
  const ends: readonly unknown[] = [points[0], points[points.length - 1]];
  return ends.includes(line.p1) || ends.includes(line.p2);
}

function matches(need: Target | 'value' | 'pairs', kind: string | undefined): boolean {
  if (kind === undefined) return false;
  if (need === 'round') return ROUND.has(kind);
  if (need === 'curve') return CURVE.has(kind);
  if (need === 'carrier') return CARRIER.has(kind);
  return need === kind;
}

/** True when the id is a non-empty string not used before; remembers it either way. */
function claimId(id: unknown, used: Set<string>): boolean {
  if (!isId(id)) return false;
  if (used.has(id)) return false;
  used.add(id);
  return true;
}

function hasExactly(
  item: Fields,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set(['kind', ...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(item, key)) &&
    Object.keys(item).every((key) => allowed.has(key))
  );
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
