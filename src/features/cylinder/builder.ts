import type { Vec3 } from '@/core';
import { bodyId } from '@/document';
import { nameShape } from '@/regen';
import type { Body, FeatureBuilder } from '@/regen';
import type { CylinderParams } from './schema';

// The behaviour half of the cylinder feature (ADR 0004): one cylinder per feature (spec 07).

/** Unit direction of each axis option; the kernel takes any non-zero axis (spec 06). */
const AXIS: Readonly<Record<CylinderParams['axis'], Vec3>> = Object.freeze({
  x: Object.freeze<Vec3>([1, 0, 0]),
  y: Object.freeze<Vec3>([0, 1, 0]),
  z: Object.freeze<Vec3>([0, 0, 1]),
});

export const cylinderBuilder: FeatureBuilder<CylinderParams> = Object.freeze<
  FeatureBuilder<CylinderParams>
>({
  type: 'cylinder',
  async build({ feature, params, state }, { kernel }) {
    // Params are valid here: evaluateParams ran cylinderSchema.validate first.
    const { base, axis, radius, height } = params;
    const result = await kernel.makeCylinder({ base, axis: AXIS[axis], radius, height });
    // Names from the roles of the kernel (spec 08); a new body has no input names.
    const names = await nameShape({ kernel, featureId: feature.id, result, inputs: [] });
    // The cylinder creates its body: the id comes from bodyId, origin and lastModifiedBy are the
    // feature itself (ADR 0015).
    const id = bodyId(feature.id);
    const body: Body = Object.freeze({
      kind: 'body',
      id,
      origin: feature.id,
      lastModifiedBy: feature.id,
      shape: result.shape,
      names,
    });
    // A new map, the input state stays as it is; the map itself is guarded by its type (Q048).
    const artifacts = new Map(state.artifacts).set(id, body);
    return { ok: true, state: Object.freeze({ artifacts }), anchors: {} };
  },
});
