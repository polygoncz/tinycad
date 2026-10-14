import type { BodyId, FeatureId } from '@/document';
import type { QueryOps, ShapeResult } from '@/kernel';
import { nameShape } from './names';
import type { NameTable } from './names';
import { isBody } from './state';
import type { Artifact, ArtifactId, Body, RegenState } from './state';

// The identity rule of a changed body (spec 07, Builder featury; ADR 0015) in one place: a
// feature that changes a body keeps its id, origin and place in the map, gives it a new shape
// with names from the kernel history and becomes lastModifiedBy; a consumed body leaves the map.
// Shared by the body operation and the builders of plugins, which may not import each other.

/**
 * The body changed by `feature` to the shape of `result`: id and origin stay, the names come
 * from nameShape over `inputs` (the tables of the input shapes in the order of the kernel call)
 * with `generatedTag`, lastModifiedBy = `feature`. Frozen; `body` stays as it is.
 */
export async function modifyBody(p: {
  readonly kernel: Pick<QueryOps, 'topology'>;
  readonly feature: FeatureId;
  readonly body: Body;
  readonly result: ShapeResult;
  readonly inputs: readonly NameTable[];
  readonly generatedTag?: string;
}): Promise<Body> {
  const { kernel, feature, body, result, inputs, generatedTag } = p;
  const names = await nameShape({
    kernel,
    featureId: feature,
    result,
    inputs,
    ...(generatedTag === undefined ? {} : { generatedTag }),
  });
  return Object.freeze({ ...body, shape: result.shape, names, lastModifiedBy: feature });
}

/**
 * A new state in the order of `state`: each body of `changed` takes the place of the body with
 * its id, bodies of `consumed` leave (consumed wins over changed), everything else stays the same
 * object. A changed body whose id is not in `state` is not added. Frozen; `state` stays as it is.
 */
export function replaceBodies(
  state: RegenState,
  changed: ReadonlyMap<BodyId, Body>,
  consumed: ReadonlySet<BodyId>,
): RegenState {
  const artifacts = new Map<ArtifactId, Artifact>();
  for (const [id, artifact] of state.artifacts) {
    if (!isBody(artifact)) {
      artifacts.set(id, artifact);
      continue;
    }
    if (consumed.has(artifact.id)) continue;
    artifacts.set(id, changed.get(artifact.id) ?? artifact);
  }
  return Object.freeze({ artifacts });
}
