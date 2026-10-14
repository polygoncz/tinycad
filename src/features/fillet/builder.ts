import { nameShape, unresolvedReference } from '@/regen';
import type { Artifact, ArtifactId, Body, FeatureBuilder, ResolvedTopo } from '@/regen';
import type { FilletParams } from './schema';

// The behaviour half of the fillet feature (ADR 0004): one kernel fillet per body with all its
// edges, the body keeps its identity (spec 07, Builder featury; R105).

export const filletBuilder: FeatureBuilder<FilletParams> = Object.freeze<
  FeatureBuilder<FilletParams>
>({
  type: 'fillet',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran filletSchema.validate first.
    const resolved = ctx.resolveTopo(feature.params.edges, 'edge');
    if (!resolved.ok) return { ok: false, error: unresolvedReference('edges', resolved.error) };

    // One call per body lets OCCT solve the corners of its edges together (R105). A kernel
    // error (a radius too large, say) propagates and becomes KERNEL.
    const results = new Map<ArtifactId, Body>();
    for (const { body, indices } of groupByBody(resolved.value)) {
      const result = await ctx.kernel.fillet(body.shape, indices, feature.params.radius);
      const names = await nameShape({
        kernel: ctx.kernel,
        featureId: feature.id,
        result,
        inputs: [body.names],
        generatedTag: 'fillet',
      });
      results.set(
        body.id,
        Object.freeze({ ...body, shape: result.shape, names, lastModifiedBy: feature.id }),
      );
    }

    // A new map in the order of the input state: each result takes the place of its body,
    // everything else stays the same object.
    const artifacts = new Map<ArtifactId, Artifact>();
    for (const [id, artifact] of state.artifacts) artifacts.set(id, results.get(id) ?? artifact);
    return { ok: true, state: Object.freeze({ artifacts }) };
  },
});

/**
 * The edges grouped by body in the order of the first reference of each body; the indices of a
 * body joined (several names may share an edge) and sorted ascending.
 */
function groupByBody(
  resolved: readonly ResolvedTopo[],
): { readonly body: Body; readonly indices: readonly number[] }[] {
  const groups = new Map<ArtifactId, { readonly body: Body; readonly indices: Set<number> }>();
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
