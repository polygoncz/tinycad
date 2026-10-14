import { validateAgainstSchema } from '@/document';
import type {
  AxisRef,
  BodyRef,
  FeatureSchema,
  ParamSchema,
  ParamSpec,
  SketchEntityRef,
  SketchRegionRef,
} from '@/document';

// The data half of the revolve feature (ADR 0004): params, defaults and validation.

const FULL_TURN = 2 * Math.PI;

export interface RevolveParams {
  /** Regions of sketches turned about the axis; one solid each (spec 07, Operace tělesa). */
  readonly regions: readonly SketchRegionRef[];
  /** An origin axis or a line of a sketch; null only before the user picks one. */
  readonly axis: AxisRef | SketchEntityRef | null;
  readonly operation: 'new' | 'add' | 'remove' | 'intersect';
  /** Bodies the solids change; only for an operation other than 'new'. */
  readonly targets: readonly BodyRef[];
  /** Radians, 0 < angle ≤ 2π. */
  readonly angle: number;
  /** Turn the other way (about the reversed axis); only below a full turn. */
  readonly flip: boolean;
}

/**
 * Whether the angle leaves room for a direction: at a full turn both directions give the same
 * solid, so flip is hidden and the builder ignores it. Takes unchecked values (visibleWhen).
 */
export function flipApplies(angle: unknown): boolean {
  return typeof angle === 'number' && angle < FULL_TURN - 1e-9;
}

// Frozen deeply – the schema object, every ParamSpec and the enum options: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// Labels are translation keys (ADR 0014), the texts are in messages.ts.
const params: ParamSchema = Object.freeze<ParamSchema>({
  regions: Object.freeze<ParamSpec>({ kind: 'region', label: 'revolve.regions', min: 1 }),
  axis: Object.freeze<ParamSpec>({ kind: 'axis', label: 'revolve.axis' }),
  operation: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'revolve.operation',
    default: 'new',
    options: Object.freeze([
      Object.freeze({ value: 'new', label: 'revolve.operation.new' }),
      Object.freeze({ value: 'add', label: 'revolve.operation.add' }),
      Object.freeze({ value: 'remove', label: 'revolve.operation.remove' }),
      Object.freeze({ value: 'intersect', label: 'revolve.operation.intersect' }),
    ]),
  }),
  targets: Object.freeze<ParamSpec>({
    kind: 'bodies',
    label: 'revolve.targets',
    min: 1,
    group: 'revolve.group.merge',
    visibleWhen: (p) => p['operation'] !== 'new',
  }),
  angle: Object.freeze<ParamSpec>({
    kind: 'angle',
    label: 'revolve.angle',
    default: FULL_TURN,
    min: 0,
    exclusiveMin: true,
    max: FULL_TURN,
  }),
  flip: Object.freeze<ParamSpec>({
    kind: 'boolean',
    label: 'revolve.flip',
    default: false,
    visibleWhen: (p) => flipApplies(p['angle']),
  }),
});

export const revolveSchema: FeatureSchema<RevolveParams> = Object.freeze<
  FeatureSchema<RevolveParams>
>({
  type: 'revolve',
  version: 1,
  label: 'revolve.label',
  icon: 'rotate-360',
  params,
  defaults(): RevolveParams {
    return {
      regions: [],
      axis: null,
      operation: 'new',
      targets: [],
      angle: FULL_TURN,
      flip: false,
    };
  },
  validate: (raw) => validateAgainstSchema(params, raw),
});
