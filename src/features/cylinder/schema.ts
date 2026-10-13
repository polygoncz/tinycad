import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamIssue, ParamSchema, ParamSpec } from '@/document';

// The data half of the cylinder feature (ADR 0004): params, defaults and validation.

export interface CylinderParams {
  /** Centre of the bottom face. */
  readonly base: Vec3;
  /** Axis of the cylinder; the height goes from base along the positive direction of the axis. */
  readonly axis: 'x' | 'y' | 'z';
  /** Radius, > 0. */
  readonly radius: number;
  /** Height along the axis, > 0. */
  readonly height: number;
}

// Frozen deeply – the schema object, every ParamSpec, the base default and the enum options:
// the schema is shared by the registry, the UI form and the validation, so nobody may change it
// in place. Labels are translation keys (ADR 0014), the texts are in messages.ts. Radius and
// height must be > 0: the exclusive lower bound 0 (Q050) covers it, no rule of its own needed.
const params: ParamSchema = Object.freeze<ParamSchema>({
  base: Object.freeze<ParamSpec>({
    kind: 'point',
    label: 'cylinder.base',
    default: Object.freeze<Vec3>([0, 0, 0]),
  }),
  axis: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'cylinder.axis',
    default: 'z',
    options: Object.freeze([
      Object.freeze({ value: 'x', label: 'cylinder.axis.x' }),
      Object.freeze({ value: 'y', label: 'cylinder.axis.y' }),
      Object.freeze({ value: 'z', label: 'cylinder.axis.z' }),
    ]),
  }),
  radius: positiveLength('cylinder.radius', 5),
  height: positiveLength('cylinder.height', 10),
});

export const cylinderSchema: FeatureSchema<CylinderParams> = Object.freeze<
  FeatureSchema<CylinderParams>
>({
  type: 'cylinder',
  version: 1,
  label: 'cylinder.label',
  icon: 'cylinder',
  params,
  defaults(): CylinderParams {
    return { base: [0, 0, 0], axis: 'z', radius: 5, height: 10 };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
});

/** A size of the cylinder: a length > 0. */
function positiveLength(label: string, defaultValue: number): ParamSpec {
  return Object.freeze<ParamSpec>({
    kind: 'length',
    label,
    default: defaultValue,
    min: 0,
    exclusiveMin: true,
  });
}
