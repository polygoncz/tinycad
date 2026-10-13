import type { MeshData } from './types';

// Structural check of MeshData (spec 06, "Síť pro vykreslení"). Only structure: lengths,
// finite numbers, unit normals, index bounds and range coverage. Orientation and geometry
// (normal vs. winding) belong to the kernel contract suite.

const UNIT_TOLERANCE = 1e-4;

/** Structural check of a mesh. Empty array = valid. For tests of both kernels and dev checks in render. */
export function validateMeshData(mesh: MeshData): readonly string[] {
  const messages: string[] = [];
  const report = (message: string): void => {
    messages.push(message);
  };

  const positionsOk = checkTriples('positions', mesh.positions.length, report);
  const normalsOk = checkTriples('normals', mesh.normals.length, report);
  if (mesh.normals.length !== mesh.positions.length) {
    report(
      `normals: length ${String(mesh.normals.length)} differs from positions length ${String(mesh.positions.length)}`,
    );
  }
  const indicesOk = checkTriples('indices', mesh.indices.length, report);
  const faceRangesOk = checkTriples('faceRanges', mesh.faceRanges.length, report);
  const edgePositionsOk = checkTriples('edgePositions', mesh.edgePositions.length, report);
  const edgeRangesOk = checkTriples('edgeRanges', mesh.edgeRanges.length, report);

  checkFinite('positions', mesh.positions, report);
  checkFinite('normals', mesh.normals, report);
  checkFinite('edgePositions', mesh.edgePositions, report);
  if (normalsOk) checkUnitNormals(mesh.normals, report);
  if (positionsOk) checkVertexIndices(mesh.indices, mesh.positions.length / 3, report);

  if (faceRangesOk) {
    const triangleCount = indicesOk ? mesh.indices.length / 3 : undefined;
    checkRanges(
      mesh.faceRanges,
      triangleCount,
      { array: 'faceRanges', item: 'triangles', first: 'firstTriangle', key: 'face', minCount: 1 },
      report,
    );
  }
  if (edgeRangesOk) {
    const pointCount = edgePositionsOk ? mesh.edgePositions.length / 3 : undefined;
    checkRanges(
      mesh.edgeRanges,
      pointCount,
      { array: 'edgeRanges', item: 'points', first: 'firstPoint', key: 'edge', minCount: 2 },
      report,
    );
  }
  return messages;
}

type Report = (message: string) => void;

function checkTriples(name: string, length: number, report: Report): boolean {
  if (length % 3 === 0) return true;
  report(`${name}: length ${String(length)} is not divisible by 3`);
  return false;
}

function checkFinite(name: string, values: Float32Array, report: Report): void {
  let count = 0;
  let first = -1;
  values.forEach((v, i) => {
    if (Number.isFinite(v)) return;
    if (count === 0) first = i;
    count++;
  });
  if (count > 0)
    report(`${name}[${String(first)}]: not finite (${String(count)} non-finite values)`);
}

function checkUnitNormals(normals: Float32Array, report: Report): void {
  for (let v = 0; v < normals.length / 3; v++) {
    const x = normals[3 * v] ?? 0;
    const y = normals[3 * v + 1] ?? 0;
    const z = normals[3 * v + 2] ?? 0;
    const length = Math.hypot(x, y, z);
    // Non-finite normals are already reported by checkFinite.
    if (Number.isFinite(length) && Math.abs(length - 1) > UNIT_TOLERANCE) {
      report(`normals: vertex ${String(v)} has length ${String(length)}`);
    }
  }
}

function checkVertexIndices(indices: Uint32Array, vertexCount: number, report: Report): void {
  indices.forEach((index, i) => {
    if (index >= vertexCount) {
      report(
        `indices[${String(i)}]: vertex ${String(index)} out of range (${String(vertexCount)} vertices)`,
      );
    }
  });
}

interface RangeLabels {
  /** Name of the ranges array, e.g. 'faceRanges'. */
  readonly array: string;
  /** What the ranges cover, e.g. 'triangles'. */
  readonly item: string;
  /** Name of the second number of a triple, e.g. 'firstTriangle'. */
  readonly first: string;
  /** What the first number of a triple identifies, e.g. 'face'. */
  readonly key: string;
  readonly minCount: number;
}

/**
 * Ranges are triples [key, first, count]. Checks unique keys, strictly increasing first (render
 * searches the ranges binarily), minimal count and – when the number of covered items is known –
 * that every item is covered exactly once.
 */
function checkRanges(
  ranges: Uint32Array,
  itemCount: number | undefined,
  labels: RangeLabels,
  report: Report,
): void {
  const rangeCount = ranges.length / 3;
  const rangeOfKey = new Map<number, number>();
  // owner[i] = index of the range that covered item i first, -1 = not covered yet.
  const owner = itemCount === undefined ? undefined : new Int32Array(itemCount).fill(-1);

  for (let r = 0; r < rangeCount; r++) {
    const key = ranges[3 * r] ?? 0;
    const first = ranges[3 * r + 1] ?? 0;
    const count = ranges[3 * r + 2] ?? 0;
    const at = `${labels.array}[${String(r)}]`;

    const previous = rangeOfKey.get(key);
    if (previous === undefined) rangeOfKey.set(key, r);
    else
      report(`${at}: ${labels.key} ${String(key)} already in ${labels.array}[${String(previous)}]`);

    const previousFirst = r > 0 ? (ranges[3 * (r - 1) + 1] ?? 0) : undefined;
    if (previousFirst !== undefined && first <= previousFirst) {
      report(
        `${at}: ${labels.first} ${String(first)} not greater than ${String(previousFirst)} in ${labels.array}[${String(r - 1)}]`,
      );
    }

    if (count < labels.minCount) {
      report(
        `${at}: ${String(count)} ${labels.item}, at least ${String(labels.minCount)} required`,
      );
    }

    if (owner === undefined || itemCount === undefined) continue;
    if (first + count > itemCount) {
      report(
        `${at}: ${labels.item} ${String(first)}..${String(first + count - 1)} out of range (${String(itemCount)} ${labels.item})`,
      );
    }
    reportOverlaps(owner, r, first, Math.min(first + count, itemCount), ranges, labels, report);
  }

  if (owner !== undefined) reportUncovered(owner, labels, report);
}

/** Marks items [from, to) as covered by range r and reports each run already covered by another range. */
function reportOverlaps(
  owner: Int32Array,
  r: number,
  from: number,
  to: number,
  ranges: Uint32Array,
  labels: RangeLabels,
  report: Report,
): void {
  let i = from;
  while (i < to) {
    const other = owner[i] ?? -1;
    if (other < 0) {
      owner[i] = r;
      i++;
      continue;
    }
    const start = i;
    while (i < to && owner[i] === other) i++;
    report(
      `${labels.array}[${String(r)}]: ${labels.item} ${String(start)}..${String(i - 1)} overlap ${labels.key} ${String(ranges[3 * other] ?? 0)}`,
    );
  }
}

function reportUncovered(owner: Int32Array, labels: RangeLabels, report: Report): void {
  let i = 0;
  while (i < owner.length) {
    if (owner[i] !== -1) {
      i++;
      continue;
    }
    const start = i;
    while (i < owner.length && owner[i] === -1) i++;
    report(
      `${labels.array}: ${labels.item} ${String(start)}..${String(i - 1)} not covered by any ${labels.key}`,
    );
  }
}
