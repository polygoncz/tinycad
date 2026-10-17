import type { AxisRef, BodyRef, SketchEntityRef, SketchRegionRef } from '@/document';

// The params of the revolve feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

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
