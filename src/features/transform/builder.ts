import { mat4, vec3 } from '@/core';
import type { Mat4, Vec3 } from '@/core';
import type { BodyId } from '@/document';
import { modifyBody, replaceBodies, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder, ModelingKernel } from '@/regen';
import type { TransformParams } from './schema';

// The behaviour half of the transform feature (ADR 0004): moves the picked bodies by one rigid
// motion. A transform changes bodies, it does not create them: each keeps its id, origin and
// place in the map; shape, names (from nameShape) and lastModifiedBy are new (spec 07, identity
// rule). The rotation goes through the pivot. For 'bodiesCenter' the pivot is also the anchor
// 'pivot' of the manipulator (M18, ADR 0021); the origin and pivotPoint are in the params, so
// the manipulator computes them itself (spec 07, the anchor is minimal).

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

export const transformBuilder: FeatureBuilder<TransformParams> = Object.freeze<
  FeatureBuilder<TransformParams>
>({
  type: 'transform',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran transformSchema.validate first.
    const { bodies: refs, pivot, pivotPoint, translate } = feature.params;
    const resolved = ctx.resolveBodies(refs);
    if (!resolved.ok) return { ok: false, error: unresolvedReference('bodies', resolved.error) };
    // From the input shapes, so it depends neither on translate nor on the angles (anchor invariant).
    const p =
      pivot === 'bodiesCenter'
        ? await centerOf(ctx.kernel, resolved.value)
        : pivot === 'point'
          ? pivotPoint
          : ORIGIN;
    // Rotate through the pivot first, then translate: T(translate) · T(p) · R · T(−p).
    const rotation = mat4.multiply(
      mat4.translation(p),
      mat4.multiply(rotationOf(feature.params), mat4.translation(vec3.scale(p, -1))),
    );
    const m = mat4.multiply(mat4.translation(translate), rotation);
    const changed = new Map<BodyId, Body>();
    for (const body of resolved.value) {
      const result = await ctx.kernel.transform(body.shape, m);
      // The history of a rigid motion is the identity, so the names stay the same (spec 08).
      changed.set(
        body.id,
        await modifyBody({
          kernel: ctx.kernel,
          feature: feature.id,
          body,
          result,
          inputs: [body.names],
        }),
      );
    }
    // Every moved body stays where it was in the map, the input state stays as it is.
    const next = replaceBodies(state, changed, new Set());
    // The Regenerator freezes the anchors deeply (spec 07). Origin and pivotPoint come from the
    // params, so only bodiesCenter needs the anchor; the empty anchors still have to be there,
    // the controller shows no handles for a feature without them.
    if (pivot !== 'bodiesCenter') return { ok: true, state: next, anchors: {} };
    return { ok: true, state: next, anchors: { pivot: { point: p } } };
  },
});

const ORIGIN: Vec3 = Object.freeze<Vec3>([0, 0, 0]);

/** The center of the joined bounding box of the bodies (at least one, the schema has min: 1). */
async function centerOf(kernel: ModelingKernel, bodies: readonly Body[]): Promise<Vec3> {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const body of bodies) {
    const box = await kernel.boundingBox(body.shape);
    min = [
      Math.min(min[0], box.min[0]),
      Math.min(min[1], box.min[1]),
      Math.min(min[2], box.min[2]),
    ];
    max = [
      Math.max(max[0], box.max[0]),
      Math.max(max[1], box.max[1]),
      Math.max(max[2], box.max[2]),
    ];
  }
  return vec3.scale(vec3.add(min, max), 0.5);
}
