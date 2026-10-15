import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamIssue, ParamSchemaOf, ParamSpec, TopoRef } from '@/document';

// The data half of the fillet feature (ADR 0004): params, defaults and validation.

export interface FilletParams {
  /** Named edges of bodies (spec 08); edges of several bodies are allowed. */
  readonly edges: readonly TopoRef[];
  /** One radius for all edges (R105: no variable radius). */
  readonly radius: number;
}

// Frozen deeply – the schema object and every ParamSpec: the schema is shared by the registry,
// the UI form and the validation, so nobody may change it in place. Labels are translation keys
// (ADR 0014), the texts are in messages.ts. The radius must be > 0: the exclusive lower bound 0
// (Q050) covers it, so the fillet needs no rule of its own.
const params: ParamSchemaOf<FilletParams> = Object.freeze<ParamSchemaOf<FilletParams>>({
  edges: Object.freeze<ParamSpec>({ kind: 'topo', label: 'fillet.edges', entity: 'edge', min: 1 }),
  radius: Object.freeze<ParamSpec>({
    kind: 'length',
    label: 'fillet.radius',
    default: 1,
    min: 0,
    exclusiveMin: true,
  }),
});

export const filletSchema: FeatureSchema<FilletParams> = Object.freeze<FeatureSchema<FilletParams>>(
  {
    type: 'fillet',
    version: 1,
    label: 'fillet.label',
    icon: 'border-radius',
    params,
    defaults(): FilletParams {
      return { edges: [], radius: 1 };
    },
    validate(raw: unknown): readonly ParamIssue[] {
      return validateAgainstSchema(params, raw);
    },
  },
);
