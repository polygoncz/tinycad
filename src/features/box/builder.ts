import type { BodyId } from '@/document';
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
    // Body naming of spec 07; the builder is the one place that mints this BodyId.
    const id = `${feature.id}/body` as BodyId;
    const body: Body = Object.freeze({ id, shape, createdBy: feature.id, names: EMPTY_NAMES });
    // A new map, the input state stays as it is; the map itself is guarded by its type (Q048).
    const bodies = new Map(state.bodies).set(id, body);
    return { ok: true, state: Object.freeze({ bodies }) };
  },
});
