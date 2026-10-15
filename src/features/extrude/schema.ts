import { validateAgainstSchema } from '@/document';
import type {
  BodyRef,
  FeatureSchema,
  ParamSchemaOf,
  ParamSpec,
  SketchRegionRef,
  TopoRef,
} from '@/document';

// The data half of the extrude feature (ADR 0004): params, defaults and validation.

export interface ExtrudeParams {
  /** Regions of sketches; the direction is the normal of the sketch of the first one. */
  readonly regions: readonly SketchRegionRef[];
  /** How the prisms change the model (spec 07, Operace tělesa). */
  readonly operation: 'new' | 'add' | 'remove' | 'intersect';
  /** Bodies the prisms change; hidden and never read for 'new'. */
  readonly targets: readonly BodyRef[];
  /**
   * 'blind' goes from the sketch plane, 'symmetric' half the distance to each side, 'upToFace'
   * (M14) up to the planar face upTo parallel to the sketch.
   */
  readonly endType: 'blind' | 'symmetric' | 'upToFace';
  /** Hidden and never read for 'upToFace'. */
  readonly distance: number;
  /** The face to extrude up to; hidden and never read unless 'upToFace' (M14). */
  readonly upTo: readonly TopoRef[];
  /** Extrude against the normal of the sketch; hidden and never read unless 'blind'. */
  readonly flip: boolean;
}

/**
 * Whether the end type leaves room for a direction: a symmetric extrude goes to both sides and
 * an extrude up to a face goes towards the face, so flip is hidden and the builder ignores it.
 * Takes unchecked values (visibleWhen).
 */
export function flipApplies(endType: unknown): boolean {
  return endType === 'blind';
}

/**
 * Whether the end type reads the distance: an extrude up to a face computes it from the face,
 * so distance is hidden and the builder ignores it. Takes unchecked values (visibleWhen).
 */
export function distanceApplies(endType: unknown): boolean {
  return endType !== 'upToFace';
}

// Frozen deeply – the schema object, every ParamSpec and the enum options: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. The predicates get the
// unchecked params, so they only compare values (spec 03, Podmíněné a seskupené parametry).
const params: ParamSchemaOf<ExtrudeParams> = Object.freeze<ParamSchemaOf<ExtrudeParams>>({
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
      Object.freeze({ value: 'upToFace', label: 'extrude.endType.upToFace' }),
    ]),
  }),
  distance: Object.freeze<ParamSpec>({
    kind: 'length',
    label: 'extrude.distance',
    default: 10,
    min: 0,
    exclusiveMin: true,
    visibleWhen: (p) => distanceApplies(p['endType']),
  }),
  // Hidden unless 'upToFace', so data of version 1 without upTo stay valid without a migration.
  upTo: Object.freeze<ParamSpec>({
    kind: 'topo',
    label: 'extrude.upTo',
    entity: 'face',
    min: 1,
    max: 1,
    visibleWhen: (p) => p['endType'] === 'upToFace',
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
      upTo: [],
      flip: false,
    };
  },
  validate: (raw) => validateAgainstSchema(params, raw),
});
