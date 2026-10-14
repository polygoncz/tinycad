// Manipulators (spec 10, "Manipulátory (M18)", ADR 0021): handles in the viewport whose drag
// changes the params of the feature with an open dialog. A plugin describes its handles with a
// ManipulatorDescriptor; geometry only regeneration knows comes in as anchors.

import { createRegistry } from '@/core';
import type { Registry, Vec3 } from '@/core';
import type { FeatureAnchors } from './regen-status-port';

export type HandleTint = 'x' | 'y' | 'z' | 'neutral';
/** mm and radians, as in the document (spec 01). */
export type HandleUnit = 'length' | 'angle';

interface HandleBase {
  /** Stable between calls of handles() ('tx', 'rz', 'distance'). */
  readonly id: string;
  /** The current value of the handle, read from params. */
  readonly value: number;
  readonly unit: HandleUnit;
  /** Inclusive; the value is clipped after snapping. */
  readonly min?: number;
  readonly max?: number;
  readonly tint: HandleTint;
  /** The change of params for a new value (only the keys the handle changes). */
  toParams(value: number): Readonly<Record<string, unknown>>;
  /** The value for the label when it differs from value (a symmetric extrude shows 2v); identity by default. */
  display?(value: number): number;
}

export interface LinearHandle extends HandleBase {
  readonly kind: 'linear';
  /** Where the glyph stands (the start of the arrow). */
  readonly position: Vec3;
  /** Unit; a positive value goes along it. */
  readonly direction: Vec3;
}

export interface AngularHandle extends HandleBase {
  readonly kind: 'angular';
  readonly center: Vec3;
  /** Unit; a positive angle is counter-clockwise looking against axis. */
  readonly axis: Vec3;
  /** Unit, perpendicular to axis; the reference direction the angle is measured from. */
  readonly zero: Vec3;
}

export type Handle = LinearHandle | AngularHandle;

export interface ManipulatorDescriptor<P = unknown> {
  /** The feature type. */
  readonly type: string;
  /**
   * A pure function; called only with valid params (issues = []) and the anchors of the feature.
   * Ids of the handles are unique; [] is allowed. A method, not a property, for bivariance (like
   * FeatureBuilder.build): ManipulatorDescriptor<TransformParams> passes as ManipulatorDescriptor.
   */
  handles(params: P, anchors: FeatureAnchors): readonly Handle[];
}

/** Key = type, see core. */
export type ManipulatorRegistry = Registry<ManipulatorDescriptor>;

export function createManipulatorRegistry(): ManipulatorRegistry {
  return createRegistry<ManipulatorDescriptor>({ what: 'manipulator', keyOf: (d) => d.type });
}
