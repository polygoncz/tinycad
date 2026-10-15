import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { BodyId } from '@/document';
import { kernelErrorCode } from '@/kernel';
import type { ShapeHandle, ShapeResult } from '@/kernel';
import { modifyBody, replaceBodies, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder, FeatureError, ModelingKernel, ResolvedTopo } from '@/regen';
import type { ChamferParams } from './schema';

// The behaviour half of the chamfer feature (ADR 0004): one kernel chamfer per body with all its
// edges, the body keeps its identity (spec 07, Builder featury; R105).

export const chamferBuilder: FeatureBuilder<ChamferParams> = Object.freeze<
  FeatureBuilder<ChamferParams>
>({
  type: 'chamfer',
  async build({ feature, params, state }, ctx) {
    // Params are valid here: evaluateParams ran chamferSchema.validate first.
    const resolved = ctx.resolveTopo(params.edges, 'edge');
    if (!resolved.ok) return { ok: false, error: unresolvedReference('edges', resolved.error) };

    // One call per body lets OCCT solve the corners of its edges together (R105). The kernel
    // failing the chamfer (a distance too large, an edge it cannot use) is an issue at the distance
    // (D6); any other kernel error propagates and becomes KERNEL.
    const changed = new Map<BodyId, Body>();
    for (const { body, indices } of groupByBody(resolved.value)) {
      const result = await chamferOrIssue(ctx.kernel, body.shape, indices, params.distance);
      if (!result.ok) return { ok: false, error: result.error };
      changed.set(
        body.id,
        await modifyBody({
          kernel: ctx.kernel,
          feature: feature.id,
          body,
          result: result.value,
          inputs: [body.names],
          generatedTag: 'chamfer',
        }),
      );
    }
    // Each result takes the place of its body, everything else stays the same object.
    return { ok: true, state: replaceBodies(state, changed, new Set()), anchors: {} };
  },
});

/**
 * The chamfer of the edges by the kernel; its 'operation-failed' becomes the INVALID_PARAMS
 * chamfer.failed at distance, so the UI shows a translated hint at the param instead of the
 * technical message of the kernel (D6). Every other error propagates.
 */
async function chamferOrIssue(
  kernel: ModelingKernel,
  shape: ShapeHandle,
  edges: readonly number[],
  distance: number,
): Promise<Result<ShapeResult, FeatureError>> {
  try {
    return ok(await kernel.chamfer(shape, edges, distance));
  } catch (e) {
    if (kernelErrorCode(e) !== 'operation-failed') throw e;
    return err(failed(e instanceof Error ? e.message : String(e)));
  }
}

/** The INVALID_PARAMS of a chamfer the kernel could not make; deeply frozen. */
function failed(message: string): FeatureError {
  return Object.freeze({
    code: 'INVALID_PARAMS',
    message,
    issues: Object.freeze([Object.freeze({ param: 'distance', code: 'chamfer.failed' })]),
  });
}

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
