import { mat4 } from '@/core';
import type { Vec3 } from '@/core';
import type { BodyId } from '@/document';
import { modifyBody, replaceBodies, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder } from '@/regen';
import type { TransformParams } from './schema';

// The behaviour half of the transform feature (ADR 0004): moves the picked bodies by one rigid
// motion. A transform changes bodies, it does not create them: each keeps its id, origin and
// place in the map; shape, names (from nameShape) and lastModifiedBy are new (spec 07, identity
// rule).

const AXIS: Readonly<Record<TransformParams['axis'], Vec3>> = Object.freeze({
  x: Object.freeze<Vec3>([1, 0, 0]),
  y: Object.freeze<Vec3>([0, 1, 0]),
  z: Object.freeze<Vec3>([0, 0, 1]),
});

export const transformBuilder: FeatureBuilder<TransformParams> = Object.freeze<
  FeatureBuilder<TransformParams>
>({
  type: 'transform',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran transformSchema.validate first.
    const { bodies: refs, translate, axis, angle } = feature.params;
    const resolved = ctx.resolveBodies(refs);
    if (!resolved.ok) return { ok: false, error: unresolvedReference('bodies', resolved.error) };
    // Rotate about the axis through the world origin first, then translate: T · R.
    const m = mat4.multiply(mat4.translation(translate), mat4.rotationAxisAngle(AXIS[axis], angle));
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
    return { ok: true, state: replaceBodies(state, changed, new Set()) };
  },
});
