import { err, ok } from '@/core';
import type { Result } from '@/core';
import { MAX_TEXT_LENGTH, TEXT_FONTS, isDimensionKind, patternParamsValid } from './model';
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
  mirror: { required: ['id', 'sources', 'axis'], optional: [] },
  linearPattern: { required: ['id', 'sources', 'direction1'], optional: ['direction2'] },
  circularPattern: { required: ['id', 'sources', 'center', 'count', 'angle'], optional: [] },
  text: {
    required: ['id', 'text', 'font', 'height', 'baseline', 'contours'],
    optional: ['construction'],
  },
};

/**
 * The entity kinds of mirrors, patterns (M36) and texts (M37): recipes whose curves are derived,
 * no constraint may refer to them.
 */
const RECIPE = new Set(['mirror', 'linearPattern', 'circularPattern', 'text']);

/** The fewest and most poles of a segment of a letter outline (a line … a cubic Bézier curve). */
const MIN_TEXT_POLES = 2;
const MAX_TEXT_POLES = 4;
/** Relative tolerance of joined and closed letter outlines (spec 12 "Text ve skice (M37)"). */
const TEXT_JOIN_TOLERANCE = 1e-9;

/** The highest spline degree (cubic); a spline's degree = min(MAX_SPLINE_DEGREE, points − 1). */
const MAX_SPLINE_DEGREE = 3;

/** Entity kind groups a constraint field may refer to. */
type Target = 'point' | 'line' | 'round' | 'curve';
const ROUND = new Set(['circle', 'arc']);
/** pointOnCurve may lie on any curve, a spline too (M29). */
const CURVE = new Set(['line', 'circle', 'arc', 'bspline', 'fitSpline']);

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
};

/**
 * Fields of each constraint kind besides `kind` and `id`; a ref field lists the entity kind it
 * needs. Pair kinds (equal, tangent) need an extra rule on the combination, see pairAllowed;
 * pointOnCurve and midpoint one on the point, see definesCurve.
 */
const CONSTRAINT_FIELDS: Readonly<Record<string, Readonly<Record<string, Target | 'value'>>>> = {
  coincident: { a: 'point', b: 'point' },
  horizontal: { line: 'line' },
  vertical: { line: 'line' },
  parallel: { a: 'line', b: 'line' },
  perpendicular: { a: 'line', b: 'line' },
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
  pointLineDistance: { point: 'point', line: 'line', value: 'value' },
  angle: { a: 'line', b: 'line', value: 'value' },
  radius: { curve: 'round', value: 'value' },
  diameter: { curve: 'round', value: 'value' },
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
    case 'text': {
      const baseline = typeof item.baseline === 'string' ? targets.get(item.baseline) : undefined;
      return (
        plainId(item.id) &&
        baseline?.kind === 'line' &&
        (TEXT_FONTS as readonly unknown[]).includes(item.font) &&
        isFiniteNumber(item.height) &&
        item.height > 0 &&
        textContentValid(item.text, item.contours)
      );
    }
    default:
      return false;
  }
}

/**
 * The string and the outlines of a text (M37): 1 … MAX_TEXT_LENGTH code points without control
 * characters; every contour belongs to a character of the string (its index in code points and its
 * code point) and is a closed chain of 2–4-pole segments with finite coordinates.
 */
function textContentValid(text: unknown, contours: unknown): boolean {
  if (typeof text !== 'string' || /\p{Cc}/u.test(text)) return false;
  const chars = Array.from(text);
  if (chars.length === 0 || chars.length > MAX_TEXT_LENGTH) return false;
  if (!Array.isArray(contours)) return false;
  return (contours as readonly unknown[]).every((c) => {
    if (!isRecord(c) || !hasExactly(c, ['char', 'code', 'segments'], [])) return false;
    const { char, code } = c;
    if (typeof char !== 'number' || !Number.isInteger(char)) return false;
    const ch = chars[char];
    return ch !== undefined && code === ch.codePointAt(0) && loopValid(c.segments);
  });
}

/** ≥ 1 segment of 2–4 finite poles, each starting where the previous ends, the last ending at the first. */
function loopValid(segments: unknown): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const items = segments as readonly unknown[];
  const poles: (readonly [number, number])[][] = [];
  for (const segment of items) {
    if (!Array.isArray(segment)) return false;
    const values = segment as readonly unknown[];
    if (values.length < MIN_TEXT_POLES || values.length > MAX_TEXT_POLES) return false;
    const pairs = values.map(finitePair);
    if (!pairs.every((p) => p !== undefined)) return false;
    poles.push(pairs);
  }
  return poles.every((segment, i) => {
    const next = poles[(i + 1) % poles.length];
    const end = segment[segment.length - 1];
    const start = next?.[0];
    return end !== undefined && start !== undefined && samePole(end, start);
  });
}

/** A pair of finite numbers, else undefined. */
function finitePair(v: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [x, y] = v as readonly unknown[];
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : undefined;
}

/** Equal coordinates within TEXT_JOIN_TOLERANCE · max(1, |coordinate|). */
function samePole(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a.every((v, i) => {
    const w = b[i] ?? Number.NaN;
    return Math.abs(v - w) <= TEXT_JOIN_TOLERANCE * Math.max(1, Math.abs(v), Math.abs(w));
  });
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
    const target = typeof v === 'string' ? targets.get(v) : undefined;
    const targetKind = target?.kind;
    if (typeof targetKind !== 'string') return false;
    refKinds.push(targetKind);
    refs.push(v);
    if (target !== undefined) refTargets.push(target);
  }
  if (refs.length === 2 && refs[0] === refs[1]) return false;
  // Mirrors, patterns and texts are recipes: no constraint refers to them (M36, M37).
  if (refKinds.some((k) => RECIPE.has(k))) return false;
  if (kind === 'tangent' && lineAtSplineEnd(refTargets)) return true;
  if (kind === 'equal' || kind === 'tangent') return pairAllowed(kind, refKinds);
  if (kind === 'pointLineDistance' && isEndOf(item.point, item.line, targets)) return false;
  const kindsMatch = Object.values(fields)
    .filter((need) => need !== 'value')
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

/** True when the point is p1 or p2 of the line. */
function isEndOf(point: unknown, line: unknown, targets: ReadonlyMap<string, Fields>): boolean {
  const target = typeof line === 'string' ? targets.get(line) : undefined;
  return target !== undefined && (target.p1 === point || target.p2 === point);
}

/** equal: two lines or two rounds; tangent: a line and a round (any order) or two rounds. */
function pairAllowed(kind: 'equal' | 'tangent', [a, b]: readonly string[]): boolean {
  const lines = [a, b].filter((k) => k === 'line').length;
  const rounds = [a, b].filter((k) => k !== undefined && ROUND.has(k)).length;
  if (kind === 'equal') return lines === 2 || rounds === 2;
  return rounds === 2 || (lines === 1 && rounds === 1);
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

function matches(need: Target | 'value', kind: string | undefined): boolean {
  if (kind === undefined) return false;
  if (need === 'round') return ROUND.has(kind);
  if (need === 'curve') return CURVE.has(kind);
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
