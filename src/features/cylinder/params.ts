import type { Vec3 } from '@/core';

// The params of the cylinder feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

export interface CylinderParams {
  /** Centre of the bottom face. */
  readonly base: Vec3;
  /** Axis of the cylinder; the height goes from base along the positive direction of the axis. */
  readonly axis: 'x' | 'y' | 'z';
  /** Radius, > 0. */
  readonly radius: number;
  /** Height along the axis, > 0. */
  readonly height: number;
}
