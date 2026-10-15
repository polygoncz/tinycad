import { err, ok, plane, type Plane, type Result, type Vec2, type Vec3 } from '@/core';

// Planar profiles for SketchOps.makeFace (spec 06, "Stav po M12") and the one check of a face
// input shared by every GeometryKernel implementation (contract bullet makeFace).

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
  const read = items.map((item, i) => readCurve(item, `${path}[${String(i)}]`, errors));
  const curves = read.filter((c) => c !== undefined);
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

function readCurve(x: unknown, path: string, errors: string[]): ProfileCurve | undefined {
  if (!isObject(x)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const kind: unknown = Reflect.get(x, 'kind');
  const id = readId(Reflect.get(x, 'id'), path, errors);
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
    case 'bspline':
      return readBSpline(x, path, errors, id);
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
 * The optional entity id of a curve (M14) as a property bag to spread into the copy: `{}` when
 * absent, `{ id }` for a non-empty string; undefined (and an error) for anything else.
 */
function readId(x: unknown, path: string, errors: string[]): { readonly id?: string } | undefined {
  if (x === undefined) return {};
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
