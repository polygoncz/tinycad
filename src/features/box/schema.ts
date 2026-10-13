import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamIssue, ParamSchema, ParamSpec } from '@/document';

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

const SIZES = ['width', 'depth', 'height'] as const;

// Frozen deeply – the schema object, every ParamSpec and the origin default: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// `min` of a ParamSpec is inclusive, so min 0 lets 0 through; positiveSizes rejects it.
const params: ParamSchema = Object.freeze<ParamSchema>({
  origin: Object.freeze<ParamSpec>({
    kind: 'point',
    label: 'Origin',
    default: Object.freeze<Vec3>([0, 0, 0]),
  }),
  width: Object.freeze<ParamSpec>({ kind: 'length', label: 'Width', default: 10, min: 0 }),
  depth: Object.freeze<ParamSpec>({ kind: 'length', label: 'Depth', default: 10, min: 0 }),
  height: Object.freeze<ParamSpec>({ kind: 'length', label: 'Height', default: 10, min: 0 }),
});

export const boxSchema: FeatureSchema<BoxParams> = Object.freeze<FeatureSchema<BoxParams>>({
  type: 'box',
  version: 1,
  label: 'Box',
  params,
  defaults(): BoxParams {
    return { origin: [0, 0, 0], width: 10, depth: 10, height: 10 };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    const issues = validateAgainstSchema(params, raw);
    return [...issues, ...positiveSizes(raw, issues)];
  },
});

/** A size of exactly 0 passes the inclusive min; it must be > 0. One issue per param at most. */
function positiveSizes(raw: unknown, reported: readonly ParamIssue[]): ParamIssue[] {
  if (typeof raw !== 'object' || raw === null) return [];
  return SIZES.filter(
    (key) => !reported.some((i) => i.param === key) && Reflect.get(raw, key) === 0,
  ).map((key) => ({ param: key, message: 'Must be greater than 0' }));
}
