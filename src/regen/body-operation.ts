import { bodyId } from '@/document';
import type { BodyId, FeatureId } from '@/document';
import type { ShapeHandle, ShapeResult } from '@/kernel';
import { modifyBody, replaceBodies } from './body-change';
import type { ModelingKernel } from './builder';
import { EMPTY_NAMES, nameShape } from './names';
import type { NameTable } from './names';
import type { Body, RegenState } from './state';

// The body operation of features that build a new shape from a sketch (spec 07, Operace tělesa;
// R65–R67): Extrude, Revolve, later Sweep and Loft. One function for all of them, because the
// identity rules belong to regen (ADR 0015) and plugins may not import each other.

export type BodyOperation = 'new' | 'add' | 'remove' | 'intersect';

/**
 * The state after the feature `feature` applied its new `shapes` (≥ 1) by `op`:
 * - 'new': one shape is the body, several are united by one union; a new body bodyId(feature)
 *   at the end of the map,
 * - 'add': one union of the first target with the other targets and the shapes; the result keeps
 *   id, origin and place of the first target, the other targets leave the map,
 * - 'remove' / 'intersect': subtract / intersect for each target on its own; each target keeps
 *   id, origin and place.
 * Names (M14): each shape is named by its roles, a boolean result by nameShape over the tables
 * of its inputs in the order of the kernel call. `targets` (≥ 1 except for 'new', ignored there)
 * are resolved bodies of `state`. A kernel error (an empty result, too) propagates. No shapes,
 * or no targets for a change, throws: the schema requires at least one, so it is a programming
 * error.
 */
export async function applyBodyOperation(p: {
  /** ctx.kernel: the Regenerator tracks the intermediate shapes and sweeps them. */
  readonly kernel: ModelingKernel;
  readonly state: RegenState;
  readonly feature: FeatureId;
  readonly op: BodyOperation;
  /** New shapes of the feature with their roles and history (M14: ShapeResult). */
  readonly shapes: readonly ShapeResult[];
  readonly targets: readonly Body[];
}): Promise<RegenState> {
  const { kernel, state, feature, op, shapes, targets } = p;
  if (shapes.length === 0) throw new Error('Body operation without a shape');
  const [firstTarget, ...otherTargets] = targets;
  if (op !== 'new' && firstTarget === undefined) {
    throw new Error(`Body operation '${op}' without a target`);
  }

  // One shape after another: a deterministic order of the kernel calls.
  const named: Named[] = [];
  for (const result of shapes) {
    named.push({ shape: result.shape, names: await nameNewShape(kernel, feature, result) });
  }
  const [first, ...others] = named;
  if (first === undefined) throw new Error('Body operation without a shape');

  if (op === 'new' || firstTarget === undefined) {
    return addNewBody(await united(kernel, feature, first, others), state, feature);
  }

  if (op === 'add') {
    // others is never empty here: there is at least one shape.
    const others = [...otherTargets, ...named];
    const result = await kernel.boolean(
      'union',
      [firstTarget.shape],
      others.map((o) => o.shape),
    );
    const inputs = [firstTarget.names, ...others.map((o) => o.names)];
    const body = await modifyBody({ kernel, feature, body: firstTarget, result, inputs });
    return replaceBodies(
      state,
      new Map([[firstTarget.id, body]]),
      new Set(otherTargets.map((b) => b.id)),
    );
  }

  const booleanOp = op === 'remove' ? 'subtract' : 'intersect';
  const changed = new Map<BodyId, Body>();
  // One target after another: a deterministic order of the kernel calls.
  for (const target of targets) {
    const result = await kernel.boolean(
      booleanOp,
      [target.shape],
      named.map((n) => n.shape),
    );
    const inputs = [target.names, ...named.map((n) => n.names)];
    changed.set(target.id, await modifyBody({ kernel, feature, body: target, result, inputs }));
  }
  return replaceBodies(state, changed, new Set());
}

/** A shape with the name table of it. */
interface Named {
  readonly shape: ShapeHandle;
  readonly names: NameTable;
}

/**
 * The names of a new shape of the feature, from its roles. Its inputs (the profile face of a
 * prism) have no names: EMPTY_NAMES stands for every input its history refers to (spec 08).
 */
function nameNewShape(
  kernel: ModelingKernel,
  feature: FeatureId,
  result: ShapeResult,
): Promise<NameTable> {
  const h = result.history;
  const links = h === undefined ? [] : [...h.modified, ...h.generated, ...h.deleted];
  const count = Math.max(0, ...links.map((link) => link.input + 1));
  const inputs = Array.from({ length: count }, () => EMPTY_NAMES);
  return nameShape({ kernel, featureId: feature, result, inputs });
}

/** `first` alone, or one union of `first` with `others` named over its history. */
async function united(
  kernel: ModelingKernel,
  feature: FeatureId,
  first: Named,
  others: readonly Named[],
): Promise<Named> {
  if (others.length === 0) return first;
  const result = await kernel.boolean(
    'union',
    [first.shape],
    others.map((o) => o.shape),
  );
  const inputs = [first.names, ...others.map((o) => o.names)];
  const names = await nameShape({ kernel, featureId: feature, result, inputs });
  return { shape: result.shape, names };
}

/** 'new': the shape (several united) as the body of the feature, at the end of the map. */
function addNewBody({ shape, names }: Named, state: RegenState, feature: FeatureId): RegenState {
  // Disjoint shapes become a compound of one body, like a boolean result (R8).
  const id = bodyId(feature);
  const body: Body = Object.freeze({
    kind: 'body',
    id,
    origin: feature,
    lastModifiedBy: feature,
    shape,
    names,
  });
  return Object.freeze({ artifacts: new Map(state.artifacts).set(id, body) });
}
