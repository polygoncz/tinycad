// Manipulators (spec 10, "Manipulátory (M18)", ADR 0021): handles in the viewport whose drag
// changes the params of the feature with an open dialog. A plugin describes its handles with a
// ManipulatorDescriptor; geometry only regeneration knows comes in as anchors.

import { createRegistry } from '@/core';
import type { Registry, Vec3 } from '@/core';
import type { FeatureAnchors } from './regen-status-port';

export type HandleTint = 'x' | 'y' | 'z' | 'neutral';
/** mm and radians, as in the document (spec 01). */
export type HandleUnit = 'length' | 'angle';

/** The change of params a handle writes (only the keys the handle changes). */
export type Patch = Readonly<Record<string, unknown>>;

interface HandleBase {
  /** Stable between calls of frame() ('tx', 'rz', 'distance'); unique across the modes. */
  readonly id: string;
  readonly unit: HandleUnit;
  readonly tint: HandleTint;
  /** M19: a dashed glyph (the pivot mode). */
  readonly dashed?: boolean;
}

/** A scalar handle: one value and an editable field of the HUD (M19). */
interface ScalarHandle extends HandleBase {
  /** The current value of the handle, read from params. */
  readonly value: number;
  /** Inclusive; the value is clipped after snapping. */
  readonly min?: number;
  readonly max?: number;
  /** M19: the shown value = value · displayScale (a symmetric extrude: 2); 1 by default. */
  readonly displayScale?: number;
  /** The change of params for a new value (only the keys the handle changes). */
  toParams(value: number): Patch;
}

export interface LinearHandle extends ScalarHandle {
  readonly kind: 'linear';
  /** Where the glyph stands (the start of the arrow). */
  readonly position: Vec3;
  /** Unit; a positive value goes along it. */
  readonly direction: Vec3;
}

export interface AngularHandle extends ScalarHandle {
  readonly kind: 'angular';
  readonly center: Vec3;
  /** Unit; a positive angle is counter-clockwise looking against axis. */
  readonly axis: Vec3;
  /** Unit, perpendicular to axis; the reference direction the angle is measured from. */
  readonly zero: Vec3;
  /** M19: a quarter circle from zero to axis × zero, or the full circle. */
  readonly extent: 'quarter' | 'full';
}

/** M19: a move in two directions at once (the square between two axes). */
export interface PlanarHandle extends HandleBase {
  readonly kind: 'planar';
  /** The corner of the square at the centre of the manipulator. */
  readonly origin: Vec3;
  /** Unit and perpendicular to each other. */
  readonly u: Vec3;
  readonly v: Vec3;
  readonly value: readonly [number, number];
  toParams(value: readonly [number, number]): Patch;
}

/** M19: a free move in the plane perpendicular to the view (the centre of the manipulator). */
export interface PointHandle extends HandleBase {
  readonly kind: 'point';
  readonly position: Vec3;
  readonly value: Vec3;
  toParams(value: Vec3): Patch;
}

export type Handle = LinearHandle | AngularHandle | PlanarHandle | PointHandle;

/** M19: a mode of the manipulator; label is a translation key (ADR 0014), icon a Tabler icon name for ui. */
export interface ManipulatorMode {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** In this mode the controller takes a click on the model and calls pickPoint; false by default. */
  readonly picksPoint?: boolean;
}

/** M19: the result of a descriptor – the point the toolbar stands at, and the handles. */
export interface ManipulatorFrame {
  readonly center: Vec3;
  readonly handles: readonly Handle[];
}

export interface ManipulatorDescriptor<P = unknown> {
  /** The feature type. */
  readonly type: string;
  /** M19: the modes; the first is the default. With 0 or 1 modes no toolbar; without modes mode is ''. */
  readonly modes?: readonly ManipulatorMode[];
  /**
   * A pure function; called only with valid params (issues = []) and the anchors of the feature;
   * null = no handles. Ids of the handles are unique. A method, not a property, for bivariance
   * (like FeatureBuilder.build): ManipulatorDescriptor<TransformParams> passes as
   * ManipulatorDescriptor.
   */
  frame(params: P, anchors: FeatureAnchors, mode: string): ManipulatorFrame | null;
  /** M19: a click on the model (a face, an edge) in the mode → a change of params; null = ignored. */
  pickPoint?(params: P, anchors: FeatureAnchors, mode: string, point: Vec3): Patch | null;
}

/** Key = type, see core. */
export type ManipulatorRegistry = Registry<ManipulatorDescriptor>;

export function createManipulatorRegistry(): ManipulatorRegistry {
  return createRegistry<ManipulatorDescriptor>({ what: 'manipulator', keyOf: (d) => d.type });
}
