import type { Vec3 } from '@/core';

// The params of the box feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

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
