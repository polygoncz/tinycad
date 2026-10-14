import { err, mat4, ok, vec3 } from '@/core';
import type { Result, Vec3 } from '@/core';
import type { FacePlane, ShapeHandle, ShapeResult } from '@/kernel';
import { applyBodyOperation, unresolvedReference } from '@/regen';
import type {
  Body,
  BuildContext,
  FeatureBuilder,
  FeatureError,
  ModelingKernel,
  ResolvedRegion,
} from '@/regen';
import { flipApplies } from './schema';
import type { ExtrudeParams } from './schema';

// The behaviour half of the extrude feature (ADR 0004): one prism per region along the normal
// of the sketch, applied to the model by the shared body operation (spec 07, Operace tělesa).

/** Tolerance of the up-to-face checks (R109): parallel and in front of the profile. */
const UP_TO_TOLERANCE = 1e-9;

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
    // flip is hidden unless 'blind', where its value is not validated, so it must not count.
    const direction: Vec3 = flip && flipApplies(endType) ? vec3.scale(normal, -1) : normal;

    // The length of every prism, in the order of the regions; distance is hidden and never
    // read for 'upToFace', the face gives each region its own length (R109).
    let lengths: readonly number[] = regions.value.map(() => distance);
    if (endType === 'upToFace') {
      const upTo = upToLengths(ctx, feature.params, regions.value, direction);
      if (!upTo.ok) return { ok: false, error: upTo.error };
      lengths = upTo.value;
    }

    // One prism per region in the order of the regions: a deterministic order of kernel calls.
    // A kernel error propagates and becomes KERNEL.
    // The results keep their roles and history: applyBodyOperation names the prisms (M14).
    const shapes: ShapeResult[] = [];
    for (const [i, region] of regions.value.entries()) {
      const length = lengths[i] ?? distance;
      const profile = await profileOf(ctx.kernel, region, endType, direction, length);
      shapes.push(await ctx.kernel.extrude(profile, direction, length));
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
 * The length from the plane of each region up to the face upTo (R109): the face with the
 * smallest index of the name, its plane from the topology of the body. A face that is not
 * planar, not parallel to the sketch or not in front of a region is an INVALID_PARAMS at upTo.
 */
function upToLengths(
  ctx: BuildContext,
  params: ExtrudeParams,
  regions: readonly ResolvedRegion[],
  direction: Vec3,
): Result<number[], FeatureError> {
  const resolved = ctx.resolveTopo(params.upTo, 'face');
  if (!resolved.ok) return err(unresolvedReference('upTo', resolved.error));
  const [target] = resolved.value;
  // min 1 and max 1 are checked by the schema, resolveTopo gives at least one index.
  const index = target?.indices[0];
  if (target === undefined || index === undefined) throw new Error('Extrude up to no face');

  const name = target.ref.name;
  const plane = target.body.names.topology.faces[index]?.plane;
  if (plane === undefined) return err(unusableFace(`Face '${name}' is not planar`));
  if (!isParallel(plane, direction)) {
    return err(unusableFace(`Face '${name}' is not parallel to the sketch`));
  }
  const lengths: number[] = [];
  for (const region of regions) {
    const length = vec3.dot(vec3.sub(plane.origin, region.sketch.plane.origin), direction);
    if (length <= UP_TO_TOLERANCE) {
      return err(unusableFace(`Face '${name}' is not in the extrude direction`));
    }
    lengths.push(length);
  }
  return ok(lengths);
}

/** Either side of the face counts: the normal points out of the solid, along or against d̂. */
function isParallel(plane: FacePlane, direction: Vec3): boolean {
  return Math.abs(vec3.dot(plane.normal, direction)) >= 1 - UP_TO_TOLERANCE;
}

/** The INVALID_PARAMS of a face the extrude cannot go up to; deeply frozen. */
function unusableFace(message: string): FeatureError {
  return Object.freeze({
    code: 'INVALID_PARAMS',
    message,
    issues: Object.freeze([Object.freeze({ param: 'upTo', code: 'extrude.upToFace' })]),
  });
}

/**
 * The face the prism starts from: the region itself for 'blind' and 'upToFace', for
 * 'symmetric' the region moved back by half the distance, so the prism ends half the distance
 * in front of the sketch.
 */
async function profileOf(
  kernel: ModelingKernel,
  region: ResolvedRegion,
  endType: ExtrudeParams['endType'],
  direction: Vec3,
  distance: number,
): Promise<ShapeHandle> {
  if (endType !== 'symmetric') return region.face;
  const back = mat4.translation(vec3.scale(direction, -distance / 2));
  return (await kernel.transform(region.face, back)).shape;
}
