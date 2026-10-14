import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { BodyRef, FeatureSchema, ParamIssue, ParamSchema, ParamSpec } from '@/document';

// The data half of the transform feature (ADR 0004): params, defaults, validation and the
// migration from version 1 (M18: version 2 added the pivot of the rotation).

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
  /** Axis of the rotation, through the pivot. */
  readonly axis: 'x' | 'y' | 'z';
  /** Rotation angle in radians (the UI shows degrees), unbounded. */
  readonly angle: number;
}

// Frozen deeply like the box schema: shared by the registry, the UI form and the validation.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. Everything the transform
// needs is covered by validateAgainstSchema, so it has no rule of its own.
const params: ParamSchema = Object.freeze<ParamSchema>({
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
  axis: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'transform.axis',
    default: 'z',
    options: Object.freeze([
      Object.freeze({ value: 'x', label: 'transform.axis.x' }),
      Object.freeze({ value: 'y', label: 'transform.axis.y' }),
      Object.freeze({ value: 'z', label: 'transform.axis.z' }),
    ]),
  }),
  angle: Object.freeze<ParamSpec>({ kind: 'angle', label: 'transform.angle', default: 0 }),
});

export const transformSchema: FeatureSchema<TransformParams> = Object.freeze<
  FeatureSchema<TransformParams>
>({
  type: 'transform',
  version: 2,
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
      axis: 'z',
      angle: 0,
    };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
  migrate,
});

/**
 * Version 1 rotated about an axis through the world origin: the pivot 'origin' keeps old
 * documents and log entries where they were. Data the migration does not know throw, which
 * fromData and the operation handlers report as a load problem (spec 03).
 */
function migrate(fromVersion: number, raw: unknown): TransformParams {
  if (fromVersion !== 1) {
    throw new Error(`Cannot migrate transform params from version ${String(fromVersion)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Transform params of version 1 must be an object');
  }
  // Unchecked params of version 1 (narrowed to an object above): migrate only adds the new
  // params; whether the rest is valid is up to validate, which the Regenerator runs before the
  // builder (spec 07), like for any params from outside.
  const old = raw as Partial<TransformParams>;
  return { ...old, pivot: 'origin', pivotPoint: [0, 0, 0] } as TransformParams;
}
