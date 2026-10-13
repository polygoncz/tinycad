import type { BodyId, PickResult } from '@/interaction';
import type { MeshData } from '@/kernel';

// Pure logic of HighlightLayer (spec 09, "Vrstvy pro interakci" and point 9 of "Synchronizace s
// regenerací"): comparing targets, which targets still exist, what is drawn. No three import, so
// it is tested in Node.

/** Same face or edge: kind, body and index. point and normal do not count. */
export function sameTarget(a: PickResult, b: PickResult): boolean {
  if (a.kind === 'face' && b.kind === 'face') {
    return a.body === b.body && a.faceIndex === b.faceIndex;
  }
  if (a.kind === 'edge' && b.kind === 'edge') {
    return a.body === b.body && a.edgeIndex === b.edgeIndex;
  }
  return false;
}

export function sameHover(a: PickResult | null, b: PickResult | null): boolean {
  if (a === null || b === null) return a === b;
  return sameTarget(a, b);
}

/** Element by element, in order: a reordered selection counts as a change. */
export function sameSelection(a: readonly PickResult[], b: readonly PickResult[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, i) => {
    const other = b[i];
    return other !== undefined && sameTarget(target, other);
  });
}

/**
 * True when the target's body is shown and its index is a key of the body's mesh (faceRanges
 * for a face, edgeRanges for an edge). Whether the index still means "the same" face after a
 * regeneration is left to topological naming (M14).
 */
export function validTarget(
  target: PickResult,
  meshOf: (body: BodyId) => MeshData | undefined,
): boolean {
  const mesh = meshOf(target.body);
  if (mesh === undefined) return false;
  return target.kind === 'face'
    ? hasKey(mesh.faceRanges, target.faceIndex)
    : hasKey(mesh.edgeRanges, target.edgeIndex);
}

/** The valid targets, in their order; the others are dropped silently. */
export function validTargets(
  targets: readonly PickResult[],
  meshOf: (body: BodyId) => MeshData | undefined,
): readonly PickResult[] {
  return targets.filter((target) => validTarget(target, meshOf));
}

/**
 * What is drawn: each selected target once, and the hover only when it is not selected
 * (the selection wins over the hover).
 */
export function drawnTargets(
  hover: PickResult | null,
  selection: readonly PickResult[],
): { readonly hover: PickResult | null; readonly selection: readonly PickResult[] } {
  const unique = selection.filter(
    (target, i) => selection.findIndex((other) => sameTarget(other, target)) === i,
  );
  const hidden = hover !== null && unique.some((target) => sameTarget(target, hover));
  return { hover: hidden ? null : hover, selection: unique };
}

/** True when some triple [key, first, count] of ranges has the given key. */
function hasKey(ranges: Uint32Array, key: number): boolean {
  for (let r = 0; r < ranges.length / 3; r++) {
    if (ranges[3 * r] === key) return true;
  }
  return false;
}
