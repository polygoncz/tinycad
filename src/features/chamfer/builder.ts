import type { BodyId } from '@/document';
import { modifyBody, replaceBodies, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder, ResolvedTopo } from '@/regen';
import type { ChamferParams } from './schema';

// The behaviour half of the chamfer feature (ADR 0004): one kernel chamfer per body with all its
// edges, the body keeps its identity (spec 07, Builder featury; R105).

export const chamferBuilder: FeatureBuilder<ChamferParams> = Object.freeze<
  FeatureBuilder<ChamferParams>
>({
  type: 'chamfer',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran chamferSchema.validate first.
    const resolved = ctx.resolveTopo(feature.params.edges, 'edge');
    if (!resolved.ok) return { ok: false, error: unresolvedReference('edges', resolved.error) };

    // One call per body lets OCCT solve the corners of its edges together (R105). A kernel
    // error (a distance too large, say) propagates and becomes KERNEL.
    const changed = new Map<BodyId, Body>();
    for (const { body, indices } of groupByBody(resolved.value)) {
      const result = await ctx.kernel.chamfer(body.shape, indices, feature.params.distance);
      changed.set(
        body.id,
        await modifyBody({
          kernel: ctx.kernel,
          feature: feature.id,
          body,
          result,
          inputs: [body.names],
          generatedTag: 'chamfer',
        }),
      );
    }
    // Each result takes the place of its body, everything else stays the same object.
    return { ok: true, state: replaceBodies(state, changed, new Set()) };
  },
});

/**
 * The edges grouped by body in the order of the first reference of each body; the indices of a
 * body joined (several names may share an edge) and sorted ascending.
 */
function groupByBody(
  resolved: readonly ResolvedTopo[],
): { readonly body: Body; readonly indices: readonly number[] }[] {
  const groups = new Map<BodyId, { readonly body: Body; readonly indices: Set<number> }>();
  for (const { body, indices } of resolved) {
    const group = groups.get(body.id) ?? { body, indices: new Set<number>() };
    for (const index of indices) group.indices.add(index);
    groups.set(body.id, group);
  }
  return [...groups.values()].map(({ body, indices }) => ({
    body,
    indices: [...indices].sort((a, b) => a - b),
  }));
}
