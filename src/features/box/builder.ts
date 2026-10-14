import { bodyId } from '@/document';
import { nameShape } from '@/regen';
import type { Body, FeatureBuilder } from '@/regen';
import type { BoxParams } from './schema';

// The behaviour half of the box feature (ADR 0004): one axis-aligned box per feature (spec 07).

export const boxBuilder: FeatureBuilder<BoxParams> = Object.freeze<FeatureBuilder<BoxParams>>({
  type: 'box',
  async build({ feature, state }, { kernel }) {
    // Params are valid here: the Regenerator ran boxSchema.validate first.
    const { origin, width, depth, height } = feature.params;
    const result = await kernel.makeBox({ origin, size: [width, depth, height] });
    // Names from the roles of the kernel (spec 08); a new body has no input names.
    const names = await nameShape({ kernel, featureId: feature.id, result, inputs: [] });
    // The box creates its body: the id comes from bodyId, origin and lastModifiedBy are the
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
    return { ok: true, state: Object.freeze({ artifacts }) };
  },
});
