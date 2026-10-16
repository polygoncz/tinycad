import { err, ok, plane, type Plane, type Result, type Vec2, type Vec3 } from '@/core';

// Planar profiles for SketchOps.makeFace (spec 06, "Stav po M12") and the one check of a face
// input shared by every GeometryKernel implementation (contract bullet makeFace). Since M30 also
// the regions of SketchOps.profileRegions and the check of its input (spec 06, "Stav po M30").
// Since M33 the intersections of SketchOps.curveIntersections and the check of the curveSegment
// input (spec 06, "Stav po M33"). Since M34 the fillet center of SketchOps.filletArc and the
// check of its input (spec 06, "Stav po M34").

/**
 * 2D curve in a plane; the same shape as Curve2 from sketch (kernel does not depend on sketch).
 * `id` (M14) is the id of the sketch entity, an opaque string for the kernel; makeFace turns it
 * into the role edge:<id> of the edge made from the curve (spec 06, "Stav po M14").
 */
export type ProfileCurve =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2; readonly id?: string }
  | {
      readonly kind: 'arc';
      readonly center: Vec2;
      readonly from: Vec2;
      readonly to: Vec2;
      readonly ccw: boolean;
      readonly id?: string;
    }
  | {
      readonly kind: 'circle';
      readonly center: Vec2;
      readonly radius: number;
      readonly id?: string;
    }
  | {
      // M29: a clamped polynomial B-spline (BSplineShape of core); it runs from the first pole
      // to the last one.
      readonly kind: 'bspline';
      readonly degree: number;
      readonly poles: readonly Vec2[];
      readonly knots: readonly number[];
      readonly id?: string;
    };

export type ProfileLoop = readonly ProfileCurve[];

/** The input of makeFace. */
export interface FaceInput {
  readonly plane: Plane;
  readonly outer: ProfileLoop;
  readonly holes: readonly ProfileLoop[];
}

/** Region (M30): a closed outer loop and holes; structurally SketchRegion of sketch. */
export interface ProfileRegion {
  /** Ids of all boundary curves (outer and holes), without duplicates, sorted (string comparison), joined by ','. */
  readonly name: string;
  /** Counter-clockwise, the curves oriented along the loop. */
  readonly outer: ProfileLoop;
  /** Clockwise. */
  readonly holes: readonly ProfileLoop[];
  /** > 0: outer minus holes. */
  readonly area: number;
}

/** The result of profileRegions (M30): regions sorted by name; a crossing gives no regions. */
export interface ProfileRegions {
  readonly regions: readonly ProfileRegion[];
  readonly crossing: boolean;
}

/** A curve of the profileRegions input after the check: its id is required (spec 06, M30). */
export type IdentifiedCurve = ProfileCurve & { readonly id: string };

/**
 * A common point of the curves `a` and `b` (M33, spec 06 "Stav po M33"); a === b is a spline
 * meeting itself (ta < tb). `ta` and `tb` are the parameters t of spec 12 "Port a parametr
 * křivky": a line [0, 1] from `from` to `to`; an arc the angle from `from` in its direction,
 * [0, sweep]; a circle the angle atan2(p − center) in [0, 2π); a spline its knot parameter.
 */
export interface CurveIntersection {
  readonly a: string;
  readonly b: string;
  readonly point: Vec2;
  readonly ta: number;
  readonly tb: number;
  /** An end of a piece the two curves share (overlapping curves). */
  readonly overlap?: true;
}

/** The input of curveSegment after the check (M33): `from < to`, both in the curve's range. */
export interface CurveSegmentInput {
  readonly curve: ProfileCurve;
  readonly from: number;
  readonly to: number;
}

/**
 * The center of a fillet (M34, spec 06 "Stav po M34"): `radius` away from the carriers of both
 * curves, `pointA` and `pointB` the projections of `center` on them, `ta` and `tb` their
 * parameters t (spec 12 "Port a parametr křivky"; on a line also outside [0, 1]).
 */
export interface FilletArc {
  readonly center: Vec2;
  readonly pointA: Vec2;
  readonly pointB: Vec2;
  readonly ta: number;
  readonly tb: number;
}

/** A curve filletArc takes: a line or an arc. */
export type FilletCurve = Extract<ProfileCurve, { kind: 'line' | 'arc' }>;

/** The input of filletArc after the check (M34). */
export interface FilletArcInput {
  readonly a: FilletCurve;
  readonly b: FilletCurve;
  readonly radius: number;
  readonly near: Vec2;
}

/** Spec 06: tolerance of plane.isOrthonormal for the face plane. */
const ORTHONORMAL_TOLERANCE = 1e-9;
/** Spec 06: two points coincide within this · max(1, |coordinate|), per coordinate. */
const POINT_TOLERANCE = 1e-7;
/** Spec 06: the two radii of an arc agree within this, relative. */
const RADIUS_TOLERANCE = 1e-7;
/** Geom_BSplineCurve::MaxDegree(): OCCT refuses a higher degree (M29). */
const MAX_SPLINE_DEGREE = 25;
/** Spec 06: an arc radius must be larger than this. */
const MIN_ARC_RADIUS = 1e-9;
/**
 * curveSegment: a parameter this much · max(1, |bound|) outside the range of the curve is taken
 * as the bound itself (a t computed by the caller from the same data may miss it by rounding).
 */
const PARAM_TOLERANCE = 1e-9;
const TURN = 2 * Math.PI;

/** For both kernels: an empty array = the input is valid, otherwise descriptions of the errors (message 'invalid-input'). */
export function validateFaceInput(p: unknown): readonly string[] {
  const parsed = parseFaceInput(p);
  return parsed.ok ? [] : parsed.error;
}

/**
 * Checks `p` against the makeFace contract and returns a fresh copy of it (isolation: nothing
 * of the input is kept), or every error found. Reads `p` synchronously and never throws.
 * Internal to kernel: the fake uses it; other implementations call validateFaceInput.
 */
export function parseFaceInput(p: unknown): Result<FaceInput, readonly string[]> {
  const errors: string[] = [];
  try {
    if (!isObject(p)) return err(['input must be an object']);
    const plane = readPlane(Reflect.get(p, 'plane'), errors);
    const outer = readLoop(Reflect.get(p, 'outer'), 'outer', errors);
    const holesValue: unknown = Reflect.get(p, 'holes');
    let holes: ProfileLoop[] | undefined;
    if (Array.isArray(holesValue)) {
      holes = [];
      holesValue.forEach((loop: unknown, i) => {
        const read = readLoop(loop, `holes[${String(i)}]`, errors);
        if (read !== undefined) holes?.push(read);
      });
    } else {
      errors.push('holes must be an array');
    }
    if (errors.length > 0 || plane === undefined || outer === undefined || holes === undefined) {
      return err(errors.length > 0 ? errors : ['invalid input']);
    }
    return ok({ plane, outer, holes });
  } catch (e) {
    // A getter that throws, a proxy… – input outside the types is still just invalid.
    return err([...errors, `cannot read input: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

function isObject(x: unknown): x is object {
  return typeof x === 'object' && x !== null;
}

function readNumbers(x: unknown, length: number): readonly number[] | undefined {
  if (!Array.isArray(x) || x.length !== length) return undefined;
  const values: readonly unknown[] = x;
  return values.every((v): v is number => typeof v === 'number' && Number.isFinite(v))
    ? values
    : undefined;
}

function readVec3(x: unknown): Vec3 | undefined {
  const v = readNumbers(x, 3);
  return v === undefined ? undefined : [v[0] ?? Number.NaN, v[1] ?? Number.NaN, v[2] ?? Number.NaN];
}

function readVec2(x: unknown): Vec2 | undefined {
  const v = readNumbers(x, 2);
  return v === undefined ? undefined : [v[0] ?? Number.NaN, v[1] ?? Number.NaN];
}

/** An array of 2D points, each of 2 finite numbers; undefined otherwise. */
function readVec2s(x: unknown): readonly Vec2[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const items: readonly unknown[] = x;
  const points = items.map(readVec2);
  return points.every((v) => v !== undefined) ? points : undefined;
}

function readPlane(x: unknown, errors: string[]): Plane | undefined {
  if (!isObject(x)) {
    errors.push('plane must be an object');
    return undefined;
  }
  const origin = readVec3(Reflect.get(x, 'origin'));
  const xDir = readVec3(Reflect.get(x, 'xDir'));
  const normal = readVec3(Reflect.get(x, 'normal'));
  if (origin === undefined || xDir === undefined || normal === undefined) {
    errors.push('plane: origin, xDir and normal must be 3 finite numbers each');
    return undefined;
  }
  const read = { origin, xDir, normal };
  if (!plane.isOrthonormal(read, ORTHONORMAL_TOLERANCE)) {
    errors.push('plane: xDir and normal must be unit and perpendicular');
    return undefined;
  }
  return read;
}

/** A loop: a single circle, or line/arc/bspline curves joined end to start, closed. */
function readLoop(x: unknown, path: string, errors: string[]): ProfileLoop | undefined {
  if (!Array.isArray(x)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  const items: readonly unknown[] = x;
  if (items.length === 0) {
    errors.push(`${path} must not be empty`);
    return undefined;
  }
  const read = items.map((item, i) => readCurve(item, `${path}[${String(i)}]`, errors, FACE_CURVE));
  const curves = read.filter((c) => c !== undefined && c !== null);
  if (curves.length !== read.length) return undefined;

  if (curves.some((c) => c.kind === 'circle')) {
    if (curves.length === 1) return curves;
    errors.push(`${path}: a circle must be the only curve of its loop`);
    return undefined;
  }
  for (let i = 0; i < curves.length; i++) {
    const end = endOf(curves[i]);
    const next = startOf(curves[(i + 1) % curves.length]);
    if (end === undefined || next === undefined || !samePoint(end, next)) {
      errors.push(
        `${path}[${String(i)}]: its end must lie on the start of the next curve (closed loop)`,
      );
      return undefined;
    }
  }
  return curves;
}

/**
 * How readCurve treats the differences between the makeFace and the profileRegions input
 * (spec 06): whether the id is required and whether a curve of zero length is an error
 * ('reject') or left out ('skip', readCurve returns null).
 */
interface CurveRules {
  readonly idRequired: boolean;
  readonly zeroLength: 'reject' | 'skip';
}

const FACE_CURVE: CurveRules = { idRequired: false, zeroLength: 'reject' };
const REGION_CURVE: CurveRules = { idRequired: true, zeroLength: 'skip' };

/**
 * Checks `p` against the profileRegions contract (spec 06, M30) and returns a fresh copy of its
 * curves without those of zero length, or every error found. The same curve rules as makeFace
 * (finite numbers, equal arc radii, valid spline knots), but every id is required, non-empty
 * and unique within the call. Reads `p` synchronously and never throws.
 */
export function parseProfileRegionsInput(
  p: unknown,
): Result<readonly IdentifiedCurve[], readonly string[]> {
  const errors: string[] = [];
  try {
    if (!isObject(p)) return err(['input must be an object']);
    const value: unknown = Reflect.get(p, 'curves');
    if (!Array.isArray(value)) return err(['curves must be an array']);
    const items: readonly unknown[] = value;
    const curves: IdentifiedCurve[] = [];
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const path = `curves[${String(i)}]`;
      // Unique among all curves, the skipped ones of zero length too.
      const id: unknown = isObject(item) ? Reflect.get(item, 'id') : undefined;
      if (typeof id === 'string' && id.length > 0) {
        if (seen.has(id)) errors.push(`${path}: id ${id} is used by another curve`);
        seen.add(id);
      }
      const curve = readCurve(item, path, errors, REGION_CURVE);
      if (curve !== undefined && curve !== null && curve.id !== undefined) {
        curves.push({ ...curve, id: curve.id });
      }
    });
    return errors.length > 0 ? err(errors) : ok(curves);
  } catch (e) {
    // A getter that throws, a proxy… – input outside the types is still just invalid.
    return err([...errors, `cannot read input: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

/**
 * Checks `p` against the curveSegment contract (spec 06, M33) and returns a fresh copy of it, or
 * every error found: the curve as makeFace takes it (its id optional), finite `from < to` in the
 * range of t (spec 12): a line [0, 1], an arc [0, sweep], a circle `from` in [0, 2π) and
 * `to ≤ from + 2π`, a spline its knot range. A parameter just outside the range (rounding) is
 * moved onto its bound. Reads `p` synchronously and never throws.
 */
export function parseCurveSegmentInput(p: unknown): Result<CurveSegmentInput, readonly string[]> {
  const errors: string[] = [];
  try {
    if (!isObject(p)) return err(['input must be an object']);
    const curve = readCurve(Reflect.get(p, 'curve'), 'curve', errors, FACE_CURVE);
    const from: unknown = Reflect.get(p, 'from');
    const to: unknown = Reflect.get(p, 'to');
    if (typeof from !== 'number' || !Number.isFinite(from)) errors.push('from must be finite');
    if (typeof to !== 'number' || !Number.isFinite(to)) errors.push('to must be finite');
    if (
      errors.length > 0 ||
      curve === undefined ||
      curve === null ||
      typeof from !== 'number' ||
      typeof to !== 'number'
    ) {
      return err(errors.length > 0 ? errors : ['invalid input']);
    }
    if (!(from < to)) return err(['from must be smaller than to']);
    const [low, high] = paramRange(curve);
    const start = snapTo(from, low);
    // A circle may run past 2π, by less than one turn from `from`: a full turn would be an arc
    // with from = to, which makeFace and profileRegions take as zero length (spec 06).
    const end = snapTo(to, curve.kind === 'circle' ? start + TURN : high);
    if (start < low || start >= (curve.kind === 'circle' ? TURN : high)) {
      return err([`from must lie in the range of the curve [${String(low)}, ${String(high)}]`]);
    }
    if (curve.kind === 'circle' ? end >= start + TURN : end > high) {
      return err([
        curve.kind === 'circle'
          ? 'to must be less than one turn after from'
          : `to must lie in the range of the curve [${String(low)}, ${String(high)}]`,
      ]);
    }
    return ok({ curve, from: start, to: end });
  } catch (e) {
    // A getter that throws, a proxy… – input outside the types is still just invalid.
    return err([...errors, `cannot read input: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

/**
 * Checks `p` against the filletArc contract (spec 06, M34) and returns a fresh copy of it, or
 * every error found: `a` and `b` lines or arcs as makeFace takes them (their ids optional), a
 * finite `radius` > 0 and a finite `near`. Reads `p` synchronously and never throws.
 */
export function parseFilletArcInput(p: unknown): Result<FilletArcInput, readonly string[]> {
  const errors: string[] = [];
  try {
    if (!isObject(p)) return err(['input must be an object']);
    const a = readFilletCurve(Reflect.get(p, 'a'), 'a', errors);
    const b = readFilletCurve(Reflect.get(p, 'b'), 'b', errors);
    const radius: unknown = Reflect.get(p, 'radius');
    const near = readVec2(Reflect.get(p, 'near'));
    if (typeof radius !== 'number' || !Number.isFinite(radius) || !(radius > 0)) {
      errors.push('radius must be finite and > 0');
    }
    if (near === undefined) errors.push('near must be 2 finite numbers');
    if (
      errors.length > 0 ||
      a === undefined ||
      b === undefined ||
      typeof radius !== 'number' ||
      near === undefined
    ) {
      return err(errors.length > 0 ? errors : ['invalid input']);
    }
    return ok({ a, b, radius, near });
  } catch (e) {
    // A getter that throws, a proxy… – input outside the types is still just invalid.
    return err([...errors, `cannot read input: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

/** A line or an arc as makeFace takes it; undefined (and an error) for anything else. */
function readFilletCurve(x: unknown, path: string, errors: string[]): FilletCurve | undefined {
  const curve = readCurve(x, path, errors, FACE_CURVE);
  if (curve === undefined || curve === null) return undefined;
  if (curve.kind === 'line' || curve.kind === 'arc') return curve;
  errors.push(`${path} must be a line or an arc`);
  return undefined;
}

/** The range of t (spec 12): a circle [0, 2π], an arc [0, sweep], a line [0, 1], a spline its knots. */
function paramRange(c: ProfileCurve): readonly [number, number] {
  switch (c.kind) {
    case 'line':
      return [0, 1];
    case 'circle':
      return [0, TURN];
    case 'arc': {
      const a0 = Math.atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
      const a1 = Math.atan2(c.to[1] - c.center[1], c.to[0] - c.center[0]);
      const sweep = (((c.ccw ? a1 - a0 : a0 - a1) % TURN) + TURN) % TURN;
      return [0, sweep];
    }
    case 'bspline':
      return [c.knots[0] ?? Number.NaN, c.knots[c.knots.length - 1] ?? Number.NaN];
  }
}

/** `value` moved onto `bound` when it lies within PARAM_TOLERANCE of it. */
function snapTo(value: number, bound: number): number {
  return Math.abs(value - bound) <= PARAM_TOLERANCE * Math.max(1, Math.abs(bound)) ? bound : value;
}

/**
 * One curve: a fresh copy, undefined (and an error) when it breaks the rules, null when it has
 * zero length and `rules` skip such curves.
 */
function readCurve(
  x: unknown,
  path: string,
  errors: string[],
  rules: CurveRules,
): ProfileCurve | null | undefined {
  if (!isObject(x)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const kind: unknown = Reflect.get(x, 'kind');
  const id = readId(Reflect.get(x, 'id'), path, errors, rules.idRequired);
  if (id === undefined) return undefined;
  switch (kind) {
    case 'line': {
      const from = readVec2(Reflect.get(x, 'from'));
      const to = readVec2(Reflect.get(x, 'to'));
      if (from === undefined || to === undefined) {
        errors.push(`${path}: from and to must be 2 finite numbers each`);
        return undefined;
      }
      if (samePoint(from, to)) {
        if (rules.zeroLength === 'skip') return null;
        errors.push(`${path}: a line must not have zero length`);
        return undefined;
      }
      return { kind, from, to, ...id };
    }
    case 'arc': {
      const center = readVec2(Reflect.get(x, 'center'));
      const from = readVec2(Reflect.get(x, 'from'));
      const to = readVec2(Reflect.get(x, 'to'));
      const ccw: unknown = Reflect.get(x, 'ccw');
      if (center === undefined || from === undefined || to === undefined) {
        errors.push(`${path}: center, from and to must be 2 finite numbers each`);
        return undefined;
      }
      if (typeof ccw !== 'boolean') {
        errors.push(`${path}: ccw must be a boolean`);
        return undefined;
      }
      if (samePoint(from, to)) {
        if (rules.zeroLength === 'skip') return null;
        errors.push(`${path}: an arc must not have zero length`);
        return undefined;
      }
      const r1 = Math.hypot(from[0] - center[0], from[1] - center[1]);
      const r2 = Math.hypot(to[0] - center[0], to[1] - center[1]);
      if (!(Math.abs(r1 - r2) <= RADIUS_TOLERANCE * Math.max(r1, r2))) {
        errors.push(`${path}: from and to must be equally far from center`);
        return undefined;
      }
      if (!(Math.min(r1, r2) > MIN_ARC_RADIUS)) {
        errors.push(`${path}: the arc radius must be > ${String(MIN_ARC_RADIUS)}`);
        return undefined;
      }
      return { kind, center, from, to, ccw, ...id };
    }
    case 'circle': {
      const center = readVec2(Reflect.get(x, 'center'));
      const radius: unknown = Reflect.get(x, 'radius');
      if (center === undefined) {
        errors.push(`${path}: center must be 2 finite numbers`);
        return undefined;
      }
      if (typeof radius !== 'number' || !Number.isFinite(radius) || !(radius > 0)) {
        errors.push(`${path}: radius must be finite and > 0`);
        return undefined;
      }
      return { kind, center, radius, ...id };
    }
    case 'bspline': {
      const spline = readBSpline(x, path, errors, id);
      // Zero length: every pole in one point (the curve lies in the hull of its poles). Its
      // ends alone do not tell: a closed spline has both in one point.
      if (spline?.kind === 'bspline' && rules.zeroLength === 'skip') {
        const [first] = spline.poles;
        if (first !== undefined && spline.poles.every((q) => samePoint(q, first))) return null;
      }
      return spline;
    }
    default:
      errors.push(`${path}: unknown curve kind ${String(kind)}`);
      return undefined;
  }
}

/**
 * A B-spline (M29), checked so that Geom_BSplineCurve never throws on it: integer degree in
 * 1..MAX_SPLINE_DEGREE, at least degree + 1 finite poles, poles + degree + 1 finite clamped
 * knots (checkKnots). Its ends are the first and the last pole (readLoop).
 */
function readBSpline(
  x: object,
  path: string,
  errors: string[],
  id: { readonly id?: string },
): ProfileCurve | undefined {
  const degree: unknown = Reflect.get(x, 'degree');
  const polesValue: unknown = Reflect.get(x, 'poles');
  const knotsValue: unknown = Reflect.get(x, 'knots');
  if (
    typeof degree !== 'number' ||
    !Number.isInteger(degree) ||
    degree < 1 ||
    degree > MAX_SPLINE_DEGREE
  ) {
    errors.push(`${path}: degree must be an integer from 1 to ${String(MAX_SPLINE_DEGREE)}`);
    return undefined;
  }
  const poles = readVec2s(polesValue);
  if (poles === undefined) {
    errors.push(`${path}: poles must be an array of 2 finite numbers each`);
    return undefined;
  }
  if (poles.length < degree + 1) {
    errors.push(
      `${path}: a spline of degree ${String(degree)} needs at least ${String(degree + 1)} poles`,
    );
    return undefined;
  }
  const knots = readNumbers(knotsValue, poles.length + degree + 1);
  if (knots === undefined) {
    errors.push(`${path}: knots must be poles + degree + 1 finite numbers`);
    return undefined;
  }
  const problem = knotsProblem(knots, degree);
  if (problem !== undefined) {
    errors.push(`${path}: ${problem}`);
    return undefined;
  }
  return { kind: 'bspline', degree, poles, knots: [...knots], ...id };
}

/**
 * Why a knot vector of the right length is not clamped, or undefined when it is: the first
 * degree + 1 knots equal, the last degree + 1 knots equal, first < last, the interior knots
 * strictly between them, non-decreasing and none repeated more than degree times. The range
 * need not be [0, 1].
 */
function knotsProblem(knots: readonly number[], degree: number): string | undefined {
  const first = knots[0] ?? Number.NaN;
  const last = knots[knots.length - 1] ?? Number.NaN;
  const interior = knots.slice(degree + 1, knots.length - degree - 1);
  if (!knots.slice(0, degree + 1).every((k) => k === first)) {
    return `knots must be clamped: the first ${String(degree + 1)} must be equal`;
  }
  if (!knots.slice(knots.length - degree - 1).every((k) => k === last)) {
    return `knots must be clamped: the last ${String(degree + 1)} must be equal`;
  }
  if (!(first < last)) return 'the first knot must be smaller than the last one';
  if (!interior.every((k) => first < k && k < last)) {
    return 'interior knots must lie strictly between the first and the last knot';
  }
  if (interior.some((k, i) => i > 0 && k < (interior[i - 1] ?? k))) {
    return 'knots must not decrease';
  }
  let run = 0;
  for (let i = 0; i < interior.length; i++) {
    run = i > 0 && interior[i] === interior[i - 1] ? run + 1 : 1;
    if (run > degree) return `an interior knot must not repeat more than ${String(degree)} times`;
  }
  return undefined;
}

/**
 * The entity id of a curve (M14) as a property bag to spread into the copy: `{}` when absent and
 * not `required`, `{ id }` for a non-empty string; undefined (and an error) for anything else.
 */
function readId(
  x: unknown,
  path: string,
  errors: string[],
  required: boolean,
): { readonly id?: string } | undefined {
  if (x === undefined && !required) return {};
  if (typeof x === 'string' && x.length > 0) return { id: x };
  errors.push(`${path}: id must be a non-empty string`);
  return undefined;
}

function startOf(c: ProfileCurve | undefined): Vec2 | undefined {
  if (c === undefined || c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[0] : c.from;
}

function endOf(c: ProfileCurve | undefined): Vec2 | undefined {
  if (c === undefined || c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[c.poles.length - 1] : c.to;
}

/** Spec 06: coordinates agree within POINT_TOLERANCE · max(1, |coordinate|). */
function samePoint(a: Vec2, b: Vec2): boolean {
  const near = (u: number, v: number): boolean =>
    Math.abs(u - v) <= POINT_TOLERANCE * Math.max(1, Math.abs(u), Math.abs(v));
  return near(a[0], b[0]) && near(a[1], b[1]);
}
