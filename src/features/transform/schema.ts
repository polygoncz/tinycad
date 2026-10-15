import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { BodyRef, FeatureSchema, ParamIssue, ParamSchemaOf, ParamSpec } from '@/document';

// The data half of the transform feature (ADR 0004): params, defaults, validation and the
// migrations (M18: version 2 added the pivot of the rotation; M19: version 3 replaced the axis
// and the angle with three angles rx, ry, rz).

export interface TransformParams {
  /** Bodies to move, at least one. */
  readonly bodies: readonly BodyRef[];
  /**
   * The point the rotation goes through: the center of the joined bounding box of the bodies,
   * the world origin (as in version 1) or pivotPoint.
   */
  readonly pivot: 'bodiesCenter' | 'origin' | 'point';
  /** Hidden and never read unless pivot is 'point'. */
  readonly pivotPoint: Vec3;
  /** Translation, applied after the rotation. */
  readonly translate: Vec3;
  /**
   * Rotation angles about the world axes through the pivot, in radians (the UI shows degrees),
   * unbounded. The rotation is R = Rz · Ry · Rx: x first, z last (Euler angles, M19).
   */
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}

// Frozen deeply like the box schema: shared by the registry, the UI form and the validation.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. Everything the transform
// needs is covered by validateAgainstSchema, so it has no rule of its own.
const params: ParamSchemaOf<TransformParams> = Object.freeze<ParamSchemaOf<TransformParams>>({
  bodies: Object.freeze<ParamSpec>({ kind: 'bodies', label: 'transform.bodies', min: 1 }),
  pivot: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'transform.pivot',
    default: 'bodiesCenter',
    options: Object.freeze([
      Object.freeze({ value: 'bodiesCenter', label: 'transform.pivot.bodiesCenter' }),
      Object.freeze({ value: 'origin', label: 'transform.pivot.origin' }),
      Object.freeze({ value: 'point', label: 'transform.pivot.point' }),
    ]),
  }),
  // The predicate gets the unchecked params, so it only compares values (spec 03).
  pivotPoint: Object.freeze<ParamSpec>({
    kind: 'point',
    label: 'transform.pivotPoint',
    default: Object.freeze<Vec3>([0, 0, 0]),
    visibleWhen: (p) => p['pivot'] === 'point',
  }),
  translate: Object.freeze<ParamSpec>({
    kind: 'point',
    label: 'transform.translate',
    default: Object.freeze<Vec3>([0, 0, 0]),
  }),
  rx: Object.freeze<ParamSpec>({ kind: 'angle', label: 'transform.rx', default: 0 }),
  ry: Object.freeze<ParamSpec>({ kind: 'angle', label: 'transform.ry', default: 0 }),
  rz: Object.freeze<ParamSpec>({ kind: 'angle', label: 'transform.rz', default: 0 }),
});

export const transformSchema: FeatureSchema<TransformParams> = Object.freeze<
  FeatureSchema<TransformParams>
>({
  type: 'transform',
  version: 3,
  label: 'transform.label',
  icon: 'arrows-move',
  params,
  defaults(): TransformParams {
    // No body is picked yet: the dialog asks for one (param.tooFewRefs) until the user picks it.
    return {
      bodies: [],
      pivot: 'bodiesCenter',
      pivotPoint: [0, 0, 0],
      translate: [0, 0, 0],
      rx: 0,
      ry: 0,
      rz: 0,
    };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
  migrate,
});

/** The angle param of version 3 that takes the angle of version 2, by its axis. */
const ANGLE_OF_AXIS: Readonly<Record<string, 'rx' | 'ry' | 'rz'>> = Object.freeze({
  x: 'rx',
  y: 'ry',
  z: 'rz',
});

/**
 * Migrates step by step to the current version: 1 → 2 → 3. Data the migration does not know
 * throw, which fromData and the operation handlers report as a load problem (spec 03).
 */
function migrate(fromVersion: number, raw: unknown): TransformParams {
  switch (fromVersion) {
    case 1:
      return fromVersion2(fromVersion1(raw));
    case 2:
      return fromVersion2(raw);
    default:
      throw new Error(`Cannot migrate transform params from version ${String(fromVersion)}`);
  }
}

/**
 * Version 1 rotated about an axis through the world origin: the pivot 'origin' keeps old
 * documents and log entries where they were.
 */
function fromVersion1(raw: unknown): Readonly<Record<string, unknown>> {
  return { ...objectOf(raw, 1), pivot: 'origin', pivotPoint: [0, 0, 0] };
}

/**
 * Version 2 rotated by one angle about one world axis: that angle goes to r<axis>, the others
 * are 0. Params with an unknown or missing axis pass unchanged: validate then reports them on the
 * feature (axis and angle unexpected, rx, ry, rz missing) and the document still loads.
 */
function fromVersion2(raw: unknown): TransformParams {
  const params = objectOf(raw, 2);
  const { axis, angle, ...rest } = params;
  const key = typeof axis === 'string' ? ANGLE_OF_AXIS[axis] : undefined;
  // Unchecked params (an object, see objectOf): migrate only moves and adds params; whether the
  // result is valid is up to validate, which the Regenerator runs before the builder (spec 07),
  // like for any params from outside.
  if (key === undefined) return params as unknown as TransformParams;
  return { ...rest, rx: 0, ry: 0, rz: 0, [key]: angle } as unknown as TransformParams;
}

/** The raw params as a record; anything but a plain object throws. */
function objectOf(raw: unknown, version: number): Readonly<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Transform params of version ${String(version)} must be an object`);
  }
  // Narrowed to a non-null, non-array object above; its keys are read as unknown values.
  return raw as Readonly<Record<string, unknown>>;
}
