import type { Vec3 } from '@/core';
import { bodyId } from '@/document';
import { EMPTY_NAMES } from '@/regen';
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
  async build({ feature, state }, { kernel }) {
    // Params are valid here: the Regenerator ran cylinderSchema.validate first.
    const { base, axis, radius, height } = feature.params;
    const { shape } = await kernel.makeCylinder({ base, axis: AXIS[axis], radius, height });
    // The cylinder creates its body: the id comes from bodyId, origin and lastModifiedBy are the
    // feature itself (ADR 0015).
    const id = bodyId(feature.id);
    const body: Body = Object.freeze({
      kind: 'body',
      id,
      origin: feature.id,
      lastModifiedBy: feature.id,
      shape,
      names: EMPTY_NAMES,
    });
    // A new map, the input state stays as it is; the map itself is guarded by its type (Q048).
    const artifacts = new Map(state.artifacts).set(id, body);
    return { ok: true, state: Object.freeze({ artifacts }) };
  },
});
