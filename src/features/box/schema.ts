import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamIssue, ParamSchemaOf, ParamSpec } from '@/document';

// The data half of the box feature (ADR 0004): params, defaults and validation.

export interface BoxParams {
  /** Corner with the smallest coordinates. */
  readonly origin: Vec3;
  /** Size along x. */
  readonly width: number;
  /** Size along y. */
  readonly depth: number;
  /** Size along z. */
  readonly height: number;
}

// Frozen deeply – the schema object, every ParamSpec and the origin default: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. Sizes must be > 0:
// the exclusive lower bound 0 (Q050) covers it, so the box needs no rule of its own.
const params: ParamSchemaOf<BoxParams> = Object.freeze<ParamSchemaOf<BoxParams>>({
  origin: Object.freeze<ParamSpec>({
    kind: 'point',
    label: 'box.origin',
    default: Object.freeze<Vec3>([0, 0, 0]),
  }),
  width: positiveLength('box.width'),
  depth: positiveLength('box.depth'),
  height: positiveLength('box.height'),
});

export const boxSchema: FeatureSchema<BoxParams> = Object.freeze<FeatureSchema<BoxParams>>({
  type: 'box',
  version: 1,
  label: 'box.label',
  icon: 'box',
  params,
  defaults(): BoxParams {
    return { origin: [0, 0, 0], width: 10, depth: 10, height: 10 };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
});

/** A size of the box: a length > 0, 10 by default. */
function positiveLength(label: string): ParamSpec {
  return Object.freeze<ParamSpec>({
    kind: 'length',
    label,
    default: 10,
    min: 0,
    exclusiveMin: true,
  });
}
