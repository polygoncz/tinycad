import type { TopoRef } from '@/document';

// The params of the fillet feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

export interface FilletParams {
  /** Named edges of bodies (spec 08); edges of several bodies are allowed. */
  readonly edges: readonly TopoRef[];
  /** One radius for all edges (R105: no variable radius). */
  readonly radius: number;
}
