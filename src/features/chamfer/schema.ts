import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamIssue, ParamSchema, ParamSpec, TopoRef } from '@/document';

// The data half of the chamfer feature (ADR 0004): params, defaults and validation.

export interface ChamferParams {
  /** Named edges of bodies (spec 08); edges of several bodies are allowed. */
  readonly edges: readonly TopoRef[];
  /** One distance on both faces of every edge (R105: symmetric only). */
  readonly distance: number;
}

// Frozen deeply – the schema object and every ParamSpec: the schema is shared by the registry,
// the UI form and the validation, so nobody may change it in place. Labels are translation keys
// (ADR 0014), the texts are in messages.ts. The distance must be > 0: the exclusive lower bound 0
// (Q050) covers it, so the chamfer needs no rule of its own.
const params: ParamSchema = Object.freeze<ParamSchema>({
  edges: Object.freeze<ParamSpec>({ kind: 'topo', label: 'chamfer.edges', entity: 'edge', min: 1 }),
  distance: Object.freeze<ParamSpec>({
    kind: 'length',
    label: 'chamfer.distance',
    default: 1,
    min: 0,
    exclusiveMin: true,
  }),
});

export const chamferSchema: FeatureSchema<ChamferParams> = Object.freeze<
  FeatureSchema<ChamferParams>
>({
  type: 'chamfer',
  version: 1,
  label: 'chamfer.label',
  icon: 'border-corner-square',
  params,
  defaults(): ChamferParams {
    return { edges: [], distance: 1 };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    return validateAgainstSchema(params, raw);
  },
});
