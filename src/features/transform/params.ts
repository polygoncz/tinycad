import { mat4 } from '@/core';
import type { Mat4, Vec3 } from '@/core';
import type { BodyRef } from '@/document';

// The params of the transform feature (ADR 0004, N123): the schema, the defaults and the validation
// come from the core (featureSchemaOf); the client keeps the type for its tools and manipulators.

export interface TransformParams {
  /** Bodies to move, at least one. */
  readonly bodies: readonly BodyRef[];
  /**
   * The point the rotation goes through: the center of the joined bounding box of the bodies,
   * the world origin (as in version 1) or pivotPoint.
   */
  readonly pivot: 'bodiesCenter' | 'origin' | 'point';
  /** Hidden and never read unless pivot is 'point'. */
  readonly pivotPoint: Vec3;
  /** Translation, applied after the rotation. */
  readonly translate: Vec3;
  /**
   * Rotation angles about the world axes through the pivot, in radians (the UI shows degrees),
   * unbounded. The rotation is R = Rz · Ry · Rx: x first, z last (Euler angles, M19).
   */
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}
/** Unit vectors of the world axes; shared with the manipulator. */
export const AXIS: Readonly<Record<'x' | 'y' | 'z', Vec3>> = Object.freeze({
  x: Object.freeze<Vec3>([1, 0, 0]),
  y: Object.freeze<Vec3>([0, 1, 0]),
  z: Object.freeze<Vec3>([0, 0, 1]),
});

type Angles = Pick<TransformParams, 'rx' | 'ry' | 'rz'>;

/** R = Rz · Ry · Rx: x first, z last (M19, Euler angles); shared with the manipulator. */
export function rotationOf({ rx, ry, rz }: Angles): Mat4 {
  return mat4.multiply(
    mat4.rotationAxisAngle(AXIS.z, rz),
    mat4.multiply(mat4.rotationAxisAngle(AXIS.y, ry), mat4.rotationAxisAngle(AXIS.x, rx)),
  );
}

/** R⁻¹ = Rx⁻¹ · Ry⁻¹ · Rz⁻¹, each by the opposite angle; shared with the manipulator. */
export function inverseRotationOf({ rx, ry, rz }: Angles): Mat4 {
  return mat4.multiply(
    mat4.rotationAxisAngle(AXIS.x, -rx),
    mat4.multiply(mat4.rotationAxisAngle(AXIS.y, -ry), mat4.rotationAxisAngle(AXIS.z, -rz)),
  );
}
