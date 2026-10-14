import { mat4, vec3 } from '@/core';
import type { Vec3 } from '@/core';
import type { ShapeHandle } from '@/kernel';
import { applyBodyOperation, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder, ModelingKernel, ResolvedRegion } from '@/regen';
import { flipApplies } from './schema';
import type { ExtrudeParams } from './schema';

// The behaviour half of the extrude feature (ADR 0004): one prism per region along the normal
// of the sketch, applied to the model by the shared body operation (spec 07, Operace tělesa).

export const extrudeBuilder: FeatureBuilder<ExtrudeParams> = Object.freeze<
  FeatureBuilder<ExtrudeParams>
>({
  type: 'extrude',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran extrudeSchema.validate first, so there is at
    // least one region and, for an operation other than 'new', at least one target.
    const { operation, endType, distance, flip } = feature.params;
    const regions = ctx.resolveRegions(feature.params.regions);
    if (!regions.ok) return { ok: false, error: unresolvedReference('regions', regions.error) };

    // A hidden targets param is never read: for 'new' it may hold anything (spec 03).
    let targets: readonly Body[] = [];
    if (operation !== 'new') {
      const resolved = ctx.resolveBodies(feature.params.targets);
      if (!resolved.ok) {
        return { ok: false, error: unresolvedReference('targets', resolved.error) };
      }
      targets = resolved.value;
    }

    const [first] = regions.value;
    // min 1 is checked by the schema; a hole here would be a bug of the Regenerator.
    if (first === undefined) throw new Error('Extrude without a region');
    const normal = first.sketch.plane.normal;
    // flip is hidden for 'symmetric', where its value is not validated, so it must not count.
    const direction: Vec3 = flip && flipApplies(endType) ? vec3.scale(normal, -1) : normal;

    // One prism per region in the order of the regions: a deterministic order of kernel calls.
    // A kernel error propagates and becomes KERNEL.
    const shapes: ShapeHandle[] = [];
    for (const region of regions.value) {
      const profile = await profileOf(ctx.kernel, region, endType, direction, distance);
      shapes.push((await ctx.kernel.extrude(profile, direction, distance)).shape);
    }

    const next = await applyBodyOperation({
      kernel: ctx.kernel,
      state,
      feature: feature.id,
      op: operation,
      shapes,
      targets,
    });
    return { ok: true, state: next };
  },
});

/**
 * The face the prism starts from: the region itself for 'blind', for 'symmetric' the region
 * moved back by half the distance, so the prism ends half the distance in front of the sketch.
 */
async function profileOf(
  kernel: ModelingKernel,
  region: ResolvedRegion,
  endType: ExtrudeParams['endType'],
  direction: Vec3,
  distance: number,
): Promise<ShapeHandle> {
  if (endType === 'blind') return region.face;
  const back = mat4.translation(vec3.scale(direction, -distance / 2));
  return (await kernel.transform(region.face, back)).shape;
}
