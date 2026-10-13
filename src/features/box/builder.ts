import { bodyId } from '@/document';
import { EMPTY_NAMES } from '@/regen';
import type { Body, FeatureBuilder } from '@/regen';
import type { BoxParams } from './schema';

// The behaviour half of the box feature (ADR 0004): one axis-aligned box per feature (spec 07).

export const boxBuilder: FeatureBuilder<BoxParams> = Object.freeze<FeatureBuilder<BoxParams>>({
  type: 'box',
  async build({ feature, state }, { kernel }) {
    // Params are valid here: the Regenerator ran boxSchema.validate first.
    const { origin, width, depth, height } = feature.params;
    const { shape } = await kernel.makeBox({ origin, size: [width, depth, height] });
    // The box creates its body: the id comes from bodyId, origin and lastModifiedBy are the
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
