import { bodyId } from '@/document';
import type { FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import type { ModelingKernel } from './builder';
import { EMPTY_NAMES } from './state';
import type { Artifact, ArtifactId, Body, RegenState } from './state';

// The body operation of features that build a new shape from a sketch (spec 07, Operace tělesa;
// R65–R67): Extrude, Revolve, later Sweep and Loft. One function for all of them, because the
// identity rules belong to regen (ADR 0015) and plugins may not import each other.

export type BodyOperation = 'new' | 'add' | 'remove' | 'intersect';

/**
 * The state after the feature `feature` applied its new `shapes` (≥ 1) by `op`:
 * - 'new': one shape is the body, several are united by one union; a new body bodyId(feature)
 *   at the end of the map,
 * - 'add': one union of the first target with the other targets and the shapes; the result keeps
 *   id, origin, names and place of the first target, the other targets leave the map,
 * - 'remove' / 'intersect': subtract / intersect for each target on its own; each target keeps
 *   id, origin, names and place.
 * `targets` (≥ 1 except for 'new', ignored there) are resolved bodies of `state`. A kernel error
 * (an empty result, too) propagates. No shapes, or no targets for a change, throws: the schema
 * requires at least one, so it is a programming error.
 */
export async function applyBodyOperation(p: {
  /** ctx.kernel: the Regenerator tracks the intermediate shapes and sweeps them. */
  readonly kernel: ModelingKernel;
  readonly state: RegenState;
  readonly feature: FeatureId;
  readonly op: BodyOperation;
  readonly shapes: readonly ShapeHandle[];
  readonly targets: readonly Body[];
}): Promise<RegenState> {
  const { kernel, state, feature, op, shapes, targets } = p;
  const [firstShape, ...otherShapes] = shapes;
  if (firstShape === undefined) throw new Error('Body operation without a shape');
  if (op === 'new') return addNewBody(kernel, state, feature, firstShape, otherShapes);

  const [firstTarget, ...otherTargets] = targets;
  if (firstTarget === undefined) throw new Error(`Body operation '${op}' without a target`);

  if (op === 'add') {
    const { shape } = await kernel.boolean(
      'union',
      [firstTarget.shape],
      [...otherTargets.map((b) => b.shape), ...shapes],
    );
    const changed = new Map([[firstTarget.id, modified(firstTarget, shape, feature)]]);
    return replaced(state, changed, new Set(otherTargets.map((b) => b.id)));
  }

  const booleanOp = op === 'remove' ? 'subtract' : 'intersect';
  const changed = new Map<ArtifactId, Body>();
  // One target after another: a deterministic order of the kernel calls.
  for (const target of targets) {
    const { shape } = await kernel.boolean(booleanOp, [target.shape], shapes);
    changed.set(target.id, modified(target, shape, feature));
  }
  return replaced(state, changed, new Set());
}

/** 'new': the shape (several united) as the body of the feature, at the end of the map. */
async function addNewBody(
  kernel: ModelingKernel,
  state: RegenState,
  feature: FeatureId,
  first: ShapeHandle,
  others: readonly ShapeHandle[],
): Promise<RegenState> {
  // Disjoint shapes become a compound of one body, like a boolean result (R8).
  const shape =
    others.length === 0 ? first : (await kernel.boolean('union', [first], others)).shape;
  const id = bodyId(feature);
  const body: Body = Object.freeze({
    kind: 'body',
    id,
    origin: feature,
    lastModifiedBy: feature,
    shape,
    names: EMPTY_NAMES,
  });
  return Object.freeze({ artifacts: new Map(state.artifacts).set(id, body) });
}

/** The body with a new shape from the feature: id, origin and names stay (ADR 0015). */
function modified(body: Body, shape: ShapeHandle, feature: FeatureId): Body {
  return Object.freeze({ ...body, shape, lastModifiedBy: feature });
}

/**
 * A new state in the order of `state`: changed bodies take their place, consumed ones leave,
 * everything else stays the same object.
 */
function replaced(
  state: RegenState,
  changed: ReadonlyMap<ArtifactId, Body>,
  consumed: ReadonlySet<ArtifactId>,
): RegenState {
  const artifacts = new Map<ArtifactId, Artifact>();
  for (const [id, artifact] of state.artifacts) {
    if (consumed.has(id)) continue;
    artifacts.set(id, changed.get(id) ?? artifact);
  }
  return Object.freeze({ artifacts });
}
