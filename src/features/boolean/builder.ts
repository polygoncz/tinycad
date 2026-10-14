import { nameShape, unresolvedReference } from '@/regen';
import type { Artifact, ArtifactId, Body, FeatureBuilder } from '@/regen';
import type { BooleanParams } from './schema';

// The behaviour half of the boolean feature (ADR 0004): one kernel boolean, one result body
// with the identity of the first target and the names from the kernel history (spec 07,
// Builder featury; R8).

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
    // union merges everything into the first target; subtract and intersect apply the tools to
    // all targets. The inputs in the order of the kernel call are also the inputs of nameShape.
    const [kernelTargets, kernelTools] =
      op === 'union' ? [[first], [...otherTargets, ...tools.value]] : [targets.value, tools.value];
    // A kernel error (an empty result) propagates and becomes KERNEL.
    const shapeResult = await ctx.kernel.boolean(
      op,
      kernelTargets.map((b) => b.shape),
      kernelTools.map((b) => b.shape),
    );
    const names = await nameShape({
      kernel: ctx.kernel,
      featureId: feature.id,
      result: shapeResult,
      inputs: [...kernelTargets, ...kernelTools].map((b) => b.names),
    });

    // The result changes the first target: it keeps id and origin (ADR 0015), the names come
    // from the history of the boolean (spec 08).
    const result: Body = Object.freeze({
      ...first,
      shape: shapeResult.shape,
      names,
      lastModifiedBy: feature.id,
    });
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
