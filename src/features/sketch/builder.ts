import { sketchId } from '@/document';
import type { ProfileLoop, ShapeHandle } from '@/kernel';
import { unresolvedReference } from '@/regen';
import type { FeatureBuilder, SketchArtifact } from '@/regen';
import { SKETCH_FEATURE_TYPE, computeRegions, parseSketchData } from '@/sketch';
import type { SketchParams } from './schema';

// The behaviour half of the sketch feature (ADR 0004, spec 12 "Featura skici"): one planar face
// in the kernel per region of the sketch, and the sketch artifact that carries them. The data
// are solved already; the builder never calls the solver.

export const sketchBuilder: FeatureBuilder<SketchParams> = Object.freeze<
  FeatureBuilder<SketchParams>
>({
  type: SKETCH_FEATURE_TYPE,
  async build({ feature, params, state }, ctx) {
    const resolved = ctx.resolvePlanes(params.plane);
    if (!resolved.ok) return { ok: false, error: unresolvedReference('plane', resolved.error) };
    // The schema allows exactly one plane (min 1, max 1) and validated the params already.
    const [resolvedPlane] = resolved.value;
    if (resolvedPlane === undefined) throw new Error(`Sketch '${feature.id}' has no plane`);
    const { plane } = resolvedPlane;
    // evaluateParams ran sketchSchema.validate first: invalid data here is a program error.
    const parsed = parseSketchData(params.entities, params.constraints);
    if (!parsed.ok) throw new Error(`Sketch '${feature.id}' has invalid data after validation`);
    const data = parsed.value;
    const { regions, crossing } = computeRegions(data);
    if (crossing) ctx.warn('Sketch curves cross each other; no regions');
    // Curve2 of sketch has the shape of ProfileCurve of kernel (ADR 0017): no conversion. One
    // face after another, in the order of the regions; a kernel error flies (KERNEL).
    const faces = new Map<string, ShapeHandle>();
    for (const region of regions) {
      const { shape } = await ctx.kernel.makeFace({
        plane,
        // M29: Curve2 has the bspline variant, ProfileCurve gets it in task 5; until then the
        // regions contain no splines (task 3), so the loops are ProfileLoops.
        outer: region.outer as ProfileLoop,
        holes: region.holes as readonly ProfileLoop[],
      });
      faces.set(region.name, shape);
    }
    const id = sketchId(feature.id);
    const artifact: SketchArtifact = Object.freeze({
      kind: 'sketch',
      id,
      owner: feature.id,
      plane,
      entities: data.entities,
      regions: faces,
    });
    // A new map, the input state stays as it is; the maps are guarded by their types (Q048).
    const artifacts = new Map(state.artifacts).set(id, artifact);
    return { ok: true, state: Object.freeze({ artifacts }), anchors: {} };
  },
});
