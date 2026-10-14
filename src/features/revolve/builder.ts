import { ok } from '@/core';
import type { Vec3 } from '@/core';
import type { ShapeHandle } from '@/kernel';
import { applyBodyOperation, unresolvedReference } from '@/regen';
import type { Body, FeatureBuilder } from '@/regen';
import { flipApplies } from './schema';
import type { RevolveParams } from './schema';

// The behaviour half of the revolve feature (ADR 0004): every region turned about the axis, the
// solids applied by the body operation of regen (spec 07, Operace tělesa; R65–R67).

export const revolveBuilder: FeatureBuilder<RevolveParams> = Object.freeze<
  FeatureBuilder<RevolveParams>
>({
  type: 'revolve',
  async build({ feature, state }, ctx) {
    // Params are valid here: the Regenerator ran revolveSchema.validate first.
    const { operation, angle, flip } = feature.params;
    const regions = ctx.resolveRegions(feature.params.regions);
    if (!regions.ok) return { ok: false, error: unresolvedReference('regions', regions.error) };
    // The schema requires an axis (param.tooFewRefs for null); a null here is a bug.
    if (feature.params.axis === null) throw new Error('Revolve without an axis');
    const axis = ctx.resolveAxis(feature.params.axis);
    if (!axis.ok) return { ok: false, error: unresolvedReference('axis', axis.error) };
    // A hidden targets (operation 'new') is not read: its value is not validated.
    const targets =
      operation === 'new' ? ok<Body[]>([]) : ctx.resolveBodies(feature.params.targets);
    if (!targets.ok) return { ok: false, error: unresolvedReference('targets', targets.error) };

    // flip is hidden at a full turn, where its value is not validated, so it must not count.
    const { origin, direction } = axis.value;
    const reversed: Vec3 = [-direction[0], -direction[1], -direction[2]];
    const kernelAxis = { origin, direction: flip && flipApplies(angle) ? reversed : direction };
    // One region after another: a deterministic order of the kernel calls. A kernel error
    // propagates and becomes KERNEL.
    const shapes: ShapeHandle[] = [];
    for (const { face } of regions.value) {
      shapes.push((await ctx.kernel.revolve(face, kernelAxis, angle)).shape);
    }
    const next = await applyBodyOperation({
      kernel: ctx.kernel,
      state,
      feature: feature.id,
      op: operation,
      shapes,
      targets: targets.value,
    });
    return { ok: true, state: next };
  },
});
