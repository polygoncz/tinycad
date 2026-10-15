import { assert } from '@/core';
import type { BodyId } from '@/interaction';
import type { ShapeHandle } from '@/kernel';

// First step of SceneSync (spec 09, "Synchronizace s regenerací", point 1): which bodies to
// tessellate and add, which to remove, which stay. Pure, no three import.

export interface ShownBody {
  readonly id: BodyId;
  readonly shape: ShapeHandle;
}

export interface BodyDiff {
  /** New bodies and bodies whose handle changed, in the order of next. */
  readonly add: readonly ShownBody[];
  /** Disappeared bodies and bodies whose handle changed, in the order of shown. */
  readonly remove: readonly BodyId[];
  /** Same BodyId and the same handle, in the order of next. */
  readonly keep: readonly BodyId[];
}

/**
 * Compares the shown bodies with the next ones. Same BodyId and handle → keep; changed handle →
 * remove and add; missing in next → remove. A duplicate BodyId in next is a bug (assert).
 */
export function diffBodies(
  shown: ReadonlyMap<BodyId, ShapeHandle>,
  next: readonly ShownBody[],
): BodyDiff {
  assertUniqueIds(next);
  const nextShapes = new Map<BodyId, ShapeHandle>(next.map(({ id, shape }) => [id, shape]));

  const add = next.filter(({ id, shape }) => shown.get(id) !== shape);
  const keep = next.filter(({ id, shape }) => shown.get(id) === shape).map(({ id }) => id);
  const remove = [...shown].filter(([id, shape]) => nextShapes.get(id) !== shape).map(([id]) => id);
  return { add, remove, keep };
}

/** A duplicate BodyId among bodies to show is a bug (assert). */
export function assertUniqueIds(bodies: readonly ShownBody[]): void {
  const ids = new Set<BodyId>();
  for (const { id } of bodies) {
    assert(!ids.has(id), `diffBodies: duplicate BodyId ${id}`);
    ids.add(id);
  }
}
