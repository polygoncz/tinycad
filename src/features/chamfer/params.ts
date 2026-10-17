import type { TopoRef } from '@/document';

// The params of the chamfer feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

export interface ChamferParams {
  /** Named edges of bodies (spec 08); edges of several bodies are allowed. */
  readonly edges: readonly TopoRef[];
  /** One distance on both faces of every edge (R105: symmetric only). */
  readonly distance: number;
}
