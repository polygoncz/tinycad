import { unresolvedReference } from '@/regen';
import type { Artifact, ArtifactId, Body, FeatureBuilder } from '@/regen';
import type { BooleanParams } from './schema';

// The behaviour half of the boolean feature (ADR 0004): one kernel boolean, one result body
// with the identity of the first target (spec 07, Builder featury; R8).

export const booleanBuilder: FeatureBuilder<BooleanParams> = Object.freeze<
  FeatureBuilder<BooleanParams>
>({
  type: 'boolean',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran booleanSchema.validate first, so both lists
    // have at least one body and no body is in both.
    const { op, keepTools } = feature.params;
    const targets = ctx.resolveBodies(feature.params.targets);
    if (!targets.ok) return { ok: false, error: unresolvedReference('targets', targets.error) };
    const tools = ctx.resolveBodies(feature.params.tools);
    if (!tools.ok) return { ok: false, error: unresolvedReference('tools', tools.error) };

    const [first, ...otherTargets] = targets.value;
    // min 1 is checked by the schema; a hole here would be a bug of the Regenerator.
    if (first === undefined) throw new Error('Boolean without a target');
    const toolShapes = tools.value.map((b) => b.shape);
    // union merges everything into the first target; subtract and intersect apply the tools to
    // all targets. A kernel error (an empty result) propagates and becomes KERNEL.
    const { shape } =
      op === 'union'
        ? await ctx.kernel.boolean(
            'union',
            [first.shape],
            [...otherTargets.map((b) => b.shape), ...toolShapes],
          )
        : await ctx.kernel.boolean(
            op,
            targets.value.map((b) => b.shape),
            toolShapes,
          );

    // The result changes the first target: it keeps id, origin and names (ADR 0015).
    const result: Body = Object.freeze({ ...first, shape, lastModifiedBy: feature.id });
    const consumed = new Set<ArtifactId>(otherTargets.map((b) => b.id));
    if (!keepTools) for (const tool of tools.value) consumed.add(tool.id);

    // A new map in the order of the input state: the result takes the place of the first
    // target, consumed bodies leave, everything else stays the same object.
    const artifacts = new Map<ArtifactId, Artifact>();
    for (const [id, artifact] of state.artifacts) {
      if (id === first.id) artifacts.set(id, result);
      else if (!consumed.has(id)) artifacts.set(id, artifact);
    }
    return { ok: true, state: Object.freeze({ artifacts }) };
  },
});
