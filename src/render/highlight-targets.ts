import type { BodyId, HighlightTarget } from '@/interaction';
import type { MeshData } from '@/kernel';
import { faceTriangles } from './mesh-index';

// Pure logic of HighlightLayer (spec 09, "Vrstvy pro interakci" and point 9 of "Synchronizace s
// regenerací"): comparing targets, which targets still exist, what is drawn. No three import, so
// it is tested in Node. Sketch entities (M12) are never valid here: HighlightPort ignores them,
// the style of the sketch drawing carries their highlight (spec 10, "Port viewportu"). Sketch
// regions (M13) are not valid here either: the highlight layer hands them to the sketch layer.
// A whole body (M14) is drawn as all its triangles.

/** A face, an edge or a whole body: what this layer draws. */
export type BodyTarget = Extract<HighlightTarget, { readonly kind: 'face' | 'edge' | 'body' }>;

/**
 * Same face or edge: kind, body and index; same whole body: body; same sketch entity: sketch and
 * entity; same sketch region: sketch and region. A PickResult's point and normal do not count.
 */
export function sameTarget(a: HighlightTarget, b: HighlightTarget): boolean {
  if (a.kind === 'face' && b.kind === 'face') {
    return a.body === b.body && a.faceIndex === b.faceIndex;
  }
  if (a.kind === 'edge' && b.kind === 'edge') {
    return a.body === b.body && a.edgeIndex === b.edgeIndex;
  }
  if (a.kind === 'body' && b.kind === 'body') return a.body === b.body;
  if (a.kind === 'sketchEntity' && b.kind === 'sketchEntity') {
    return a.sketch === b.sketch && a.entity === b.entity;
  }
  if (a.kind === 'sketchRegion' && b.kind === 'sketchRegion') {
    return a.sketch === b.sketch && a.region === b.region;
  }
  return false;
}

export function sameHover(a: HighlightTarget | null, b: HighlightTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return sameTarget(a, b);
}

/** Element by element, in order: a reordered selection counts as a change. */
export function sameSelection(
  a: readonly HighlightTarget[],
  b: readonly HighlightTarget[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, i) => {
    const other = b[i];
    return other !== undefined && sameTarget(target, other);
  });
}

/**
 * True when the target is a face, an edge or a whole body, its body is shown and (face, edge) its
 * index is a key of the body's mesh (faceRanges for a face, edgeRanges for an edge). Whether the
 * index still means "the same" face after a regeneration is left to topological naming (M14).
 */
export function validTarget(
  target: HighlightTarget,
  meshOf: (body: BodyId) => MeshData | undefined,
): target is BodyTarget {
  // Sketch entities and regions are not drawn by the body highlight (regions: the sketch layer).
  if (target.kind === 'sketchEntity' || target.kind === 'sketchRegion') return false;
  const mesh = meshOf(target.body);
  if (mesh === undefined) return false;
  if (target.kind === 'body') return true;
  return target.kind === 'face'
    ? hasKey(mesh.faceRanges, target.faceIndex)
    : hasKey(mesh.edgeRanges, target.edgeIndex);
}

/** The valid targets, in their order; the others are dropped silently. */
export function validTargets(
  targets: readonly HighlightTarget[],
  meshOf: (body: BodyId) => MeshData | undefined,
): readonly BodyTarget[] {
  return targets.filter((target) => validTarget(target, meshOf));
}

/**
 * What is drawn: each selected target once, and the hover only when it is not selected
 * (the selection wins over the hover).
 */
export function drawnTargets<T extends HighlightTarget>(
  hover: T | null,
  selection: readonly T[],
): { readonly hover: T | null; readonly selection: readonly T[] } {
  const unique = selection.filter(
    (target, i) => selection.findIndex((other) => sameTarget(other, target)) === i,
  );
  const hidden = hover !== null && unique.some((target) => sameTarget(target, hover));
  return { hover: hidden ? null : hover, selection: unique };
}

/**
 * Unindexed copy of the triangles of all faces of a body, face after face in the order of
 * faceRanges (faceTriangles of each, joined), for the whole-body highlight (M14). Positions only:
 * the highlight is unlit.
 */
export function bodyTriangles(mesh: MeshData): { positions: Float32Array<ArrayBuffer> } {
  const faces: Float32Array[] = [];
  for (let r = 0; r < mesh.faceRanges.length / 3; r++) {
    faces.push(faceTriangles(mesh, mesh.faceRanges[3 * r] ?? 0).positions);
  }
  const positions = new Float32Array(faces.reduce((sum, face) => sum + face.length, 0));
  let offset = 0;
  for (const face of faces) {
    positions.set(face, offset);
    offset += face.length;
  }
  return { positions };
}

/** True when some triple [key, first, count] of ranges has the given key. */
function hasKey(ranges: Uint32Array, key: number): boolean {
  for (let r = 0; r < ranges.length / 3; r++) {
    if (ranges[3 * r] === key) return true;
  }
  return false;
}
