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

/** A loop: a single circle, or line/arc curves joined end to start, closed. */
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
      return { kind, from, to };
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
      return { kind, center, from, to, ccw };
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
      return { kind, center, radius };
    }
    default:
      errors.push(`${path}: unknown curve kind ${String(kind)}`);
      return undefined;
  }
}

function startOf(c: ProfileCurve | undefined): Vec2 | undefined {
  return c === undefined || c.kind === 'circle' ? undefined : c.from;
}

function endOf(c: ProfileCurve | undefined): Vec2 | undefined {
  return c === undefined || c.kind === 'circle' ? undefined : c.to;
}

/** Spec 06: coordinates agree within POINT_TOLERANCE · max(1, |coordinate|). */
function samePoint(a: Vec2, b: Vec2): boolean {
  const near = (u: number, v: number): boolean =>
    Math.abs(u - v) <= POINT_TOLERANCE * Math.max(1, Math.abs(u), Math.abs(v));
  return near(a[0], b[0]) && near(a[1], b[1]);
}
