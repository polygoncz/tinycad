import type { BodyId } from '@/document';
import { modifyBody, replaceBodies, unresolvedReference } from '@/regen';
import type { FeatureBuilder } from '@/regen';
import type { BooleanParams } from './schema';

// The behaviour half of the boolean feature (ADR 0004): one kernel boolean, one result body
// with the identity of the first target and the names from the kernel history (spec 07,
// Builder featury; R8).

export const booleanBuilder: FeatureBuilder<BooleanParams> = Object.freeze<
  FeatureBuilder<BooleanParams>
>({
  type: 'boolean',
  async build({ feature, params, state }, ctx) {
    // Params are valid here: evaluateParams ran booleanSchema.validate first, so both lists
    // have at least one body and no body is in both.
    const { op, keepTools } = params;
    const targets = ctx.resolveBodies(params.targets);
    if (!targets.ok) return { ok: false, error: unresolvedReference('targets', targets.error) };
    const tools = ctx.resolveBodies(params.tools);
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
    // The result changes the first target: it keeps id and origin (ADR 0015), the names come
    // from the history of the boolean (spec 08).
    const result = await modifyBody({
      kernel: ctx.kernel,
      feature: feature.id,
      body: first,
      result: shapeResult,
      inputs: [...kernelTargets, ...kernelTools].map((b) => b.names),
    });
    const consumed = new Set<BodyId>(otherTargets.map((b) => b.id));
    if (!keepTools) for (const tool of tools.value) consumed.add(tool.id);

    // The result takes the place of the first target, consumed bodies leave, everything else
    // stays the same object.
    return {
      ok: true,
      state: replaceBodies(state, new Map([[first.id, result]]), consumed),
      anchors: {},
    };
  },
});
