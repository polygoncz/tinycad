import type { MeshData } from '@/kernel';

// Pure functions over MeshData (spec 09, "Reprezentace tělesa"). No three import, so they are
// tested in Node. Face and edge "index" is always the key in faceRanges/edgeRanges (the first
// number of a triple), never the position of the triple.

/**
 * Edge polylines → line segments (pairs of points) for THREE.LineSegments. A polyline of N
 * points gives N−1 segments; segmentEdges[i] is the edge key of segment i.
 */
export function polylinesToSegments(
  edgePositions: Float32Array,
  edgeRanges: Uint32Array,
): { positions: Float32Array<ArrayBuffer>; segmentEdges: Uint32Array<ArrayBuffer> } {
  let segmentCount = 0;
  forEachRange(edgeRanges, (_edge, _first, count) => {
    segmentCount += segmentsOf(count);
  });

  const positions = new Float32Array(segmentCount * 6);
  const segmentEdges = new Uint32Array(segmentCount);
  let segment = 0;
  forEachRange(edgeRanges, (edge, first, count) => {
    for (let i = 0; i < segmentsOf(count); i++) {
      copySegment(edgePositions, first + i, positions, segment);
      segmentEdges[segment] = edge;
      segment++;
    }
  });
  return { positions, segmentEdges };
}

/**
 * Face key of a triangle, undefined outside all ranges. Binary search over firstTriangle, which
 * validateMeshData guarantees to be strictly increasing.
 */
export function triangleToFace(faceRanges: Uint32Array, triangle: number): number | undefined {
  // Last range whose firstTriangle <= triangle.
  let low = 0;
  let high = faceRanges.length / 3 - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((faceRanges[3 * mid + 1] ?? 0) <= triangle) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0) return undefined;
  const first = faceRanges[3 * found + 1] ?? 0;
  const count = faceRanges[3 * found + 2] ?? 0;
  return triangle < first + count ? faceRanges[3 * found] : undefined;
}

/**
 * Unindexed copy of the triangles of one face (with their vertex normals) for the face
 * highlight. A copy, so disposing the highlight never touches the body's buffers. Unknown face
 * → empty arrays: the highlight silently drops targets that no longer exist (spec 09 point 9).
 */
export function faceTriangles(
  mesh: MeshData,
  faceIndex: number,
): { positions: Float32Array<ArrayBuffer>; normals: Float32Array<ArrayBuffer> } {
  const range = findRange(mesh.faceRanges, faceIndex);
  const triangleCount = range?.count ?? 0;
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  if (range === undefined) return { positions, normals };

  for (let corner = 0; corner < triangleCount * 3; corner++) {
    const vertex = mesh.indices[range.first * 3 + corner] ?? 0;
    positions.set(mesh.positions.subarray(3 * vertex, 3 * vertex + 3), 3 * corner);
    normals.set(mesh.normals.subarray(3 * vertex, 3 * vertex + 3), 3 * corner);
  }
  return { positions, normals };
}

/**
 * Segments (pairs of points) of one edge for the edge highlight, as a copy. Unknown edge →
 * empty array (see faceTriangles).
 */
export function edgeSegments(mesh: MeshData, edgeIndex: number): Float32Array<ArrayBuffer> {
  const range = findRange(mesh.edgeRanges, edgeIndex);
  const segmentCount = range === undefined ? 0 : segmentsOf(range.count);
  const positions = new Float32Array(segmentCount * 6);
  if (range === undefined) return positions;

  for (let i = 0; i < segmentCount; i++) {
    copySegment(mesh.edgePositions, range.first + i, positions, i);
  }
  return positions;
}

/** Calls fn for each triple [key, first, count] of a ranges array. */
function forEachRange(
  ranges: Uint32Array,
  fn: (key: number, first: number, count: number) => void,
): void {
  for (let r = 0; r < ranges.length / 3; r++) {
    fn(ranges[3 * r] ?? 0, ranges[3 * r + 1] ?? 0, ranges[3 * r + 2] ?? 0);
  }
}

/** The range with the given key; keys are not sorted, so a linear scan. */
function findRange(
  ranges: Uint32Array,
  key: number,
): { readonly first: number; readonly count: number } | undefined {
  for (let r = 0; r < ranges.length / 3; r++) {
    if (ranges[3 * r] === key)
      return { first: ranges[3 * r + 1] ?? 0, count: ranges[3 * r + 2] ?? 0 };
  }
  return undefined;
}

/** Number of segments of a polyline with count points (0 for fewer than 2 points). */
function segmentsOf(count: number): number {
  return Math.max(0, count - 1);
}

/** Copies points point and point+1 of a polyline into segment `segment` of target. */
function copySegment(
  points: Float32Array,
  point: number,
  target: Float32Array,
  segment: number,
): void {
  target.set(points.subarray(3 * point, 3 * point + 6), 6 * segment);
}
