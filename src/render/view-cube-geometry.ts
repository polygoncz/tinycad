// Geometry of the view cube (spec 09, "View cube"): a bevelled cube with half edge 1 split
// into 26 clickable regions, and picking a region from a hit point. Pure, no three import;
// the viewport turns the buffers into a BufferGeometry with one group per region.

import { assert, vec3, type Vec3 } from '@/core';
import { viewBasis } from './camera-math';

/** Direction (sx, sy, sz) ∈ {−1, 0, 1}³ ∖ {0} of a region; also the view direction after a click. */
export type CubeRegion = Vec3;

export interface ViewCubeMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly index: Uint32Array;
  /** One group per region: index range and direction of the region. */
  readonly groups: readonly {
    readonly start: number;
    readonly count: number;
    readonly region: CubeRegion;
  }[];
}

const DEFAULT_BEVEL = 0.25;
/** A coordinate this close below 1 − bevel still counts to the bevel (spec 09, "Picking"). */
const REGION_TOLERANCE = 1e-6;

/** All 26 regions: faces first, then edges, then corners. */
const REGIONS: readonly CubeRegion[] = (() => {
  const all: CubeRegion[] = [];
  for (const sx of [-1, 0, 1])
    for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) all.push([sx, sy, sz]);
  const nonZero = (r: CubeRegion): number => r.filter((c) => c !== 0).length;
  return [1, 2, 3].flatMap((n) => all.filter((r) => nonZero(r) === n));
})();

/**
 * Bevelled cube with half edge 1: faces are squares |u|, |v| ≤ 1 − bevel, edges are
 * rectangular bevels between two faces, corners are triangles. Every region has its own
 * vertices (flat shading), the normal is the normalised sum of the adjacent face normals and
 * the triangles are counter-clockwise seen from outside. Face UVs run 0..1 along
 * faceLabelBasis (u right, v up), so the label is upright in the standard view of the face;
 * edges and corners carry no label and have UV (0, 0).
 */
export function buildViewCube(bevel = DEFAULT_BEVEL): ViewCubeMesh {
  assert(bevel > 0 && bevel < 1, 'bevel must be in (0, 1)');
  const inner = 1 - bevel;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const groups: ViewCubeMesh['groups'][number][] = [];

  for (const region of REGIONS) {
    const normal = vec3.normalize(region);
    const polygon = counterClockwise(regionPolygon(region, inner), normal);
    const label = isFace(region) ? faceLabelBasis(region) : null;
    const first = positions.length / 3;
    for (const p of polygon) {
      positions.push(...p);
      normals.push(...normal);
      if (label === null) uvs.push(0, 0);
      else uvs.push(toUv(vec3.dot(p, label.right), inner), toUv(vec3.dot(p, label.up), inner));
    }
    const start = index.length;
    // Fan triangulation; the polygons are convex.
    for (let i = 1; i + 1 < polygon.length; i++) index.push(first, first + i, first + i + 1);
    groups.push({ start, count: index.length - start, region });
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    index: new Uint32Array(index),
    groups,
  };
}

/**
 * Region of a point on the cube surface: every coordinate with |p| ≥ 1 − bevel − 1e-6 gives
 * its sign, others 0. The boundary 1 − bevel belongs to the bevel. Null when all are 0.
 */
export function cubeRegionAt(point: Vec3, bevel = DEFAULT_BEVEL): CubeRegion | null {
  const threshold = 1 - bevel - REGION_TOLERANCE;
  const sign = (c: number): number => (c >= threshold ? 1 : c <= -threshold ? -1 : 0);
  const region: CubeRegion = [sign(point[0]), sign(point[1]), sign(point[2])];
  return region.every((c) => c === 0) ? null : region;
}

/** Stable key of a region, e.g. "1,-1,0". */
export function regionKey(region: CubeRegion): string {
  return region.join(',');
}

/** Label basis of a face: the text axes right and up = viewBasis(face direction). */
export function faceLabelBasis(face: CubeRegion): { readonly right: Vec3; readonly up: Vec3 } {
  const { right, up } = viewBasis(face);
  return { right, up };
}

function isFace(region: CubeRegion): boolean {
  return region.filter((c) => c !== 0).length === 1;
}

/** Maps a coordinate in ⟨−inner, inner⟩ to ⟨0, 1⟩. */
function toUv(coordinate: number, inner: number): number {
  return (coordinate / inner + 1) / 2;
}

/**
 * Vertices of the region in some cyclic order. Each vertex has the value ±1 on one axis of
 * the region and ±inner on the others; a face spans ±inner on its two free axes, an edge
 * ±inner on its free axis.
 */
function regionPolygon(region: CubeRegion, inner: number): readonly Vec3[] {
  const axes = [0, 1, 2].filter((a) => region[a] !== 0);
  const free = [0, 1, 2].filter((a) => region[a] === 0);
  const point = (outer: number, freeValues: readonly number[]): Vec3 => {
    const p: [number, number, number] = [0, 0, 0];
    for (const a of axes) p[a] = (region[a] ?? 0) * (a === outer ? 1 : inner);
    free.forEach((a, i) => (p[a] = freeValues[i] ?? 0));
    return p;
  };

  const [a0 = 0, a1 = 0] = axes;
  if (axes.length === 1) {
    const square: readonly (readonly [number, number])[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    return square.map(([s, t]) => point(a0, [s * inner, t * inner]));
  }
  if (axes.length === 2) {
    return [point(a0, [-inner]), point(a1, [-inner]), point(a1, [inner]), point(a0, [inner])];
  }
  return axes.map((a) => point(a, []));
}

/** The polygon, reversed when needed so it is counter-clockwise seen along the normal. */
function counterClockwise(polygon: readonly Vec3[], normal: Vec3): readonly Vec3[] {
  const [p0, p1, p2] = polygon;
  assert(p0 !== undefined && p1 !== undefined && p2 !== undefined, 'polygon needs 3 vertices');
  const winding = vec3.cross(vec3.sub(p1, p0), vec3.sub(p2, p0));
  return vec3.dot(winding, normal) > 0 ? polygon : [...polygon].reverse();
}
