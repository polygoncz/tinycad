import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { BodyRef, FeatureSchema, ParamIssue, ParamSchema, ParamSpec } from '@/document';

// The data half of the transform feature (ADR 0004): params, defaults and validation.

export interface TransformParams {
  /** Bodies to move, at least one. */
  readonly bodies: readonly BodyRef[];
  /** Translation, applied after the rotation. */
  readonly translate: Vec3;
  /** Axis of the rotation, through the world origin. */
  readonly axis: 'x' | 'y' | 'z';
  /** Rotation angle in radians (the UI shows degrees), unbounded. */
  readonly angle: number;
}

// Frozen deeply like the box schema: shared by the registry, the UI form and the validation.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. Everything the transform
// needs is covered by validateAgainstSchema, so it has no rule of its own.
const params: ParamSchema = Object.freeze<ParamSchema>({
  bodies: Object.freeze<ParamSpec>({ kind: 'bodies', label: 'transform.bodies', min: 1 }),
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
  version: 1,
  label: 'transform.label',
  icon: 'arrows-move',
  params,
  defaults(): TransformParams {
    // No body is picked yet: the dialog asks for one (param.tooFewRefs) until the user picks it.
    return { bodies: [], translate: [0, 0, 0], axis: 'z', angle: 0 };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
});
