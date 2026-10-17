import type { BodyRef, SketchRegionRef, TopoRef } from '@/document';

// The params of the extrude feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

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
 * an extrude up to a face goes towards the face, so flip is hidden and the core ignores it.
 * Takes unchecked values (visibleWhen).
 */
export function flipApplies(endType: unknown): boolean {
  return endType === 'blind';
}
