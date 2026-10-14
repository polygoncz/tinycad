import { validateAgainstSchema } from '@/document';
import type { BodyRef, FeatureSchema, ParamSchema, ParamSpec, SketchRegionRef } from '@/document';

// The data half of the extrude feature (ADR 0004): params, defaults and validation.

export interface ExtrudeParams {
  /** Regions of sketches; the direction is the normal of the sketch of the first one. */
  readonly regions: readonly SketchRegionRef[];
  /** How the prisms change the model (spec 07, Operace tělesa). */
  readonly operation: 'new' | 'add' | 'remove' | 'intersect';
  /** Bodies the prisms change; hidden and never read for 'new'. */
  readonly targets: readonly BodyRef[];
  /** 'blind' goes from the sketch plane, 'symmetric' half the distance to each side. */
  readonly endType: 'blind' | 'symmetric';
  readonly distance: number;
  /** Extrude against the normal of the sketch; hidden and never read for 'symmetric'. */
  readonly flip: boolean;
}

/**
 * Whether the end type leaves room for a direction: a symmetric extrude goes to both sides, so
 * flip is hidden and the builder ignores it. Takes unchecked values (visibleWhen).
 */
export function flipApplies(endType: unknown): boolean {
  return endType !== 'symmetric';
}

// Frozen deeply – the schema object, every ParamSpec and the enum options: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. The predicates get the
// unchecked params, so they only compare values (spec 03, Podmíněné a seskupené parametry).
const params: ParamSchema = Object.freeze<ParamSchema>({
  regions: Object.freeze<ParamSpec>({ kind: 'region', label: 'extrude.regions', min: 1 }),
  operation: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'extrude.operation',
    default: 'new',
    options: Object.freeze([
      Object.freeze({ value: 'new', label: 'extrude.operation.new' }),
      Object.freeze({ value: 'add', label: 'extrude.operation.add' }),
      Object.freeze({ value: 'remove', label: 'extrude.operation.remove' }),
      Object.freeze({ value: 'intersect', label: 'extrude.operation.intersect' }),
    ]),
  }),
  targets: Object.freeze<ParamSpec>({
    kind: 'bodies',
    label: 'extrude.targets',
    min: 1,
    group: 'extrude.group.merge',
    visibleWhen: (p) => p['operation'] !== 'new',
  }),
  endType: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'extrude.endType',
    default: 'blind',
    options: Object.freeze([
      Object.freeze({ value: 'blind', label: 'extrude.endType.blind' }),
      Object.freeze({ value: 'symmetric', label: 'extrude.endType.symmetric' }),
    ]),
  }),
  distance: Object.freeze<ParamSpec>({
    kind: 'length',
    label: 'extrude.distance',
    default: 10,
    min: 0,
    exclusiveMin: true,
  }),
  flip: Object.freeze<ParamSpec>({
    kind: 'boolean',
    label: 'extrude.flip',
    default: false,
    visibleWhen: (p) => flipApplies(p['endType']),
  }),
});

export const extrudeSchema: FeatureSchema<ExtrudeParams> = Object.freeze<
  FeatureSchema<ExtrudeParams>
>({
  type: 'extrude',
  version: 1,
  label: 'extrude.label',
  icon: 'arrow-big-up-lines',
  params,
  defaults(): ExtrudeParams {
    return {
      regions: [],
      operation: 'new',
      targets: [],
      endType: 'blind',
      distance: 10,
      flip: false,
    };
  },
  validate: (raw) => validateAgainstSchema(params, raw),
});
