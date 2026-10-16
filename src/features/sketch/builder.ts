import { sketchId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { unresolvedReference } from '@/regen';
import type { FeatureBuilder, SketchArtifact } from '@/regen';
import { SKETCH_FEATURE_TYPE, parseSketchData, regionCurves } from '@/sketch';
import type { SketchParams } from './schema';

// The behaviour half of the sketch feature (ADR 0004, spec 12 "Featura skici"): the regions of
// the sketch from the kernel (M30, ADR 0028), one planar face per region, and the sketch artifact
// that carries the faces and the outlines. The data are solved already; the builder never calls
// the solver.

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
    // Curve2 of sketch has the shape of ProfileCurve of kernel (ADR 0017): no conversion. A
    // kernel error of profileRegions or makeFace flies (KERNEL).
    const { regions, crossing } = await ctx.kernel.profileRegions({ curves: regionCurves(data) });
    if (crossing) ctx.warn('Sketch curves cross each other; no regions');
    // One face after another, in the order of the regions.
    const faces = new Map<string, ShapeHandle>();
    for (const region of regions) {
      const { shape } = await ctx.kernel.makeFace({
        plane,
        outer: region.outer,
        holes: region.holes,
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
      outlines: regions,
    });
    // A new map, the input state stays as it is; the maps are guarded by their types (Q048).
    const artifacts = new Map(state.artifacts).set(id, artifact);
    return { ok: true, state: Object.freeze({ artifacts }), anchors: {} };
  },
});
