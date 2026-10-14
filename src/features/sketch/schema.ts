import { ORIGIN_PLANE_IDS, validateAgainstSchema } from '@/document';
import type {
  FeatureSchema,
  ParamIssue,
  ParamSchema,
  ParamSpec,
  PlaneRef,
  TopoRef,
} from '@/document';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchEntity } from '@/sketch';

// The data half of the sketch feature (ADR 0004): params, defaults and validation (spec 12,
// "Featura skici"). The coordinates in the params are solved already: regeneration never calls
// the solver.

export interface SketchParams {
  /** Exactly one plane; the origin plane XY by default; a planar body face since M14. */
  readonly plane: readonly (PlaneRef | TopoRef)[];
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

// Frozen deeply – the schema object and every ParamSpec: the schema is shared by the registry,
// the UI and the validation. Labels are translation keys (ADR 0014), the texts are in
// messages.ts. Entities and constraints are 'data' params: no form field, their content is
// checked by parseSketchData in validate.
const params: ParamSchema = Object.freeze<ParamSchema>({
  plane: Object.freeze<ParamSpec>({ kind: 'planes', label: 'sketch.plane', min: 1, max: 1 }),
  entities: Object.freeze<ParamSpec>({ kind: 'data', label: 'sketch.entities' }),
  constraints: Object.freeze<ParamSpec>({ kind: 'data', label: 'sketch.constraints' }),
});

export const sketchSchema: FeatureSchema<SketchParams> = Object.freeze<FeatureSchema<SketchParams>>(
  {
    type: SKETCH_FEATURE_TYPE,
    version: 1,
    label: 'sketch.label',
    icon: 'pencil',
    params,
    defaults(): SketchParams {
      return {
        plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
        entities: [],
        constraints: [],
      };
    },
    validate(raw: unknown): readonly ParamIssue[] {
      const issues = validateAgainstSchema(params, raw);
      const entities = field(raw, 'entities');
      const constraints = field(raw, 'constraints');
      // A missing field is reported by validateAgainstSchema already; parse only a complete pair.
      if (entities === undefined || constraints === undefined) return issues;
      const parsed = parseSketchData(entities, constraints);
      if (parsed.ok) return issues;
      return [
        ...issues,
        ...parsed.error.map((issue): ParamIssue => ({
          param: issue.path,
          code: issue.code,
          params: { index: issue.index },
        })),
      ];
    },
  },
);

/** The field `key` of `raw` when `raw` is an object, otherwise undefined. */
function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
}
