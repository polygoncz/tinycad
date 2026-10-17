import type { BodyRef } from '@/document';

// The params of the boolean feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

export interface BooleanParams {
  /** union merges the tools into the first target; subtract and intersect use all targets. */
  readonly op: 'union' | 'subtract' | 'intersect';
  /** The first target gives the result its identity (spec 07, Builder featury). */
  readonly targets: readonly BodyRef[];
  readonly tools: readonly BodyRef[];
  /** Keep the tool bodies instead of consuming them. */
  readonly keepTools: boolean;
}
