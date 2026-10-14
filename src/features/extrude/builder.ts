import { err, mat4, ok, vec3 } from '@/core';
import type { Plane, Result, Vec3 } from '@/core';
import type { ShapeHandle, ShapeResult } from '@/kernel';
import { applyBodyOperation, unresolvedReference } from '@/regen';
import type {
  Body,
  BuildContext,
  FeatureAnchors,
  FeatureBuilder,
  FeatureError,
  ModelingKernel,
  ResolvedRegion,
} from '@/regen';
import { flipApplies } from './schema';
import type { ExtrudeParams } from './schema';

// The behaviour half of the extrude feature (ADR 0004): one prism per region along the normal
// of the sketch, applied to the model by the shared body operation (spec 07, Operace tělesa).
// For 'blind' and 'symmetric' it also gives the anchor 'base' of the distance arrow (M18,
// ADR 0021): the center of the regions in the sketch plane and the sketch normal. flip is in
// the params, so the manipulator applies it itself (spec 07, the anchor is minimal).

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
    // From the regions and the sketch plane only, so it depends neither on distance nor on flip
    // (anchor invariant). Up to face has no handle, so no anchor. The Regenerator freezes it
    // (spec 07).
    if (endType === 'upToFace') return { ok: true, state: next };
    const anchors: FeatureAnchors = {
      base: {
        point: await baseOf(ctx.kernel, regions.value, first.sketch.plane),
        direction: normal,
      },
    };
    return { ok: true, state: next, anchors };
  },
});

/**
 * The length from the plane of each region up to the face upTo (R109): its plane from
 * resolvePlanes (the face with the smallest index of the name, several warn; a missing or a
 * non-planar face is an unresolved reference, spec 08). A face that is not parallel to the
 * sketch or not in front of a region is an INVALID_PARAMS at upTo.
 */
function upToLengths(
  ctx: BuildContext,
  params: ExtrudeParams,
  regions: readonly ResolvedRegion[],
  direction: Vec3,
): Result<number[], FeatureError> {
  const resolved = ctx.resolvePlanes(params.upTo);
  if (!resolved.ok) return err(unresolvedReference('upTo', resolved.error));
  const [target] = resolved.value;
  // min 1 and max 1 are checked by the schema; a hole here would be a bug of the Regenerator.
  if (target === undefined) throw new Error('Extrude up to no face');

  // upTo holds only topo references (schema), so the name is there for the messages.
  const name = target.ref.kind === 'topo' ? target.ref.name : target.ref.plane;
  const { plane } = target;
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
function isParallel(plane: Plane, direction: Vec3): boolean {
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

/**
 * The center of the joined bounding box of the region faces, projected into the sketch plane
 * (the plane of the first region, which also gives the direction):
 * q − n·((q − origin)·n). For a slanted plane the center of the box may lie off the plane.
 */
async function baseOf(
  kernel: ModelingKernel,
  regions: readonly ResolvedRegion[],
  plane: Plane,
): Promise<Vec3> {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const region of regions) {
    const box = await kernel.boundingBox(region.face);
    min = [
      Math.min(min[0], box.min[0]),
      Math.min(min[1], box.min[1]),
      Math.min(min[2], box.min[2]),
    ];
    max = [
      Math.max(max[0], box.max[0]),
      Math.max(max[1], box.max[1]),
      Math.max(max[2], box.max[2]),
    ];
  }
  const q = vec3.scale(vec3.add(min, max), 0.5);
  const { origin, normal } = plane;
  return vec3.sub(q, vec3.scale(normal, vec3.dot(vec3.sub(q, origin), normal)));
}
