import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '@/core';
import type { BodyId, PickFilter } from '@/interaction';
import type { MeshData } from '@/kernel';
import { unionBounds } from '@/render/bounds';
import { createBodyMaterials, createBodyView, type BodyView } from '@/render/body-view';
import { LIGHT_PALETTE } from '@/render/palette';
import { createPicker } from '@/render/picker';
import { aBoxMesh } from '@/render/testing';

// Branded ids are created by a cast in tests only.
const A = 'f1/body' as BodyId;
const B = 'f2/body' as BodyId;
const C = 'f3/body' as BodyId;
const SIZE = 1000;

/** Looking down −Z at the origin; 1 px = 0.1 mm, px (500, 500) is the origin. */
function topCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Two boxes in a row along the view direction: A in front (z 10..20), B behind (z 0..5). */
function setup() {
  const materials = createBodyMaterials(LIGHT_PALETTE);
  const view = (id: BodyId, z: number, height: number): BodyView =>
    createBodyView(id, aBoxMesh([-10, -10, z], [10, 10, z + height]), materials);
  const views = [view(A, 10, 10), view(B, 0, 5)];
  /** How many times the picker asked for the views, i.e. looked at the scene. */
  let sceneQueries = 0;
  const picker = createPicker({
    views: () => {
      sceneQueries++;
      return views;
    },
    bounds: () => unionBounds(views.map((v) => v.bounds)),
  });
  const camera = topCamera();
  const pickAt = (x: number, y: number, filter?: PickFilter) =>
    picker.pick(camera, x, y, SIZE, SIZE, filter);
  // (3, −7) on the top face of A, far from its edges.
  const pickCenter = (filter?: PickFilter) => pickAt(SIZE / 2 + 30, SIZE / 2 + 70, filter);
  // (9.7, 0): 3 px from the edge x = 10 of the top face of A, inside the edge tolerance.
  const pickNearEdge = (filter?: PickFilter) => pickAt(SIZE / 2 + 97, SIZE / 2, filter);
  const isVisible = (point: Vec3) => picker.isVisible(camera, point);
  return { views, pickCenter, pickNearEdge, isVisible, sceneQueries: () => sceneQueries };
}

describe('Picker visibility', () => {
  it('picks the front body when everything is visible', () => {
    const { pickCenter } = setup();
    expect(pickCenter()).toMatchObject({ kind: 'face', body: A });
  });

  it('skips a hidden body and hits the one behind it', () => {
    const { views, pickCenter } = setup();
    const front = views[0];
    if (front === undefined) throw new Error('no front view');
    front.object.visible = false;
    expect(pickCenter()).toMatchObject({ kind: 'face', body: B });
  });

  it('finds nothing when every body is hidden', () => {
    const { views, pickCenter } = setup();
    for (const view of views) view.object.visible = false;
    expect(pickCenter()).toBeNull();
  });
});

describe('Picker.isVisible', () => {
  it('is false for a point behind a body', () => {
    // Between A (z 10..20) and B (z 0..5), under A seen from above.
    expect(setup().isVisible([3, -7, 7])).toBe(false);
  });

  it('is true on the front face and in front of a body', () => {
    const { isVisible } = setup();
    expect(isVisible([3, -7, 20])).toBe(true);
    expect(isVisible([3, -7, 30])).toBe(true);
  });

  it('ignores a hidden body', () => {
    const { views, isVisible } = setup();
    const front = views[0];
    if (front === undefined) throw new Error('no front view');
    front.object.visible = false;
    expect(isVisible([3, -7, 7])).toBe(true);
  });

  it('is true without bodies', () => {
    const picker = createPicker({ views: () => [], bounds: () => null });
    expect(picker.isVisible(topCamera(), [0, 0, -50])).toBe(true);
  });
});

describe('Picker filter', () => {
  it('without a filter an edge near the cursor wins over the face under it', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge()).toMatchObject({ kind: 'edge' });
  });

  it('the order of the kinds does not matter: the edge still wins', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['face', 'edge'])).toMatchObject({ kind: 'edge' });
    expect(pickNearEdge(['edge', 'face'])).toMatchObject({ kind: 'edge' });
  });

  it('with faces only it hits the face and does not project the edges', () => {
    const { views, pickNearEdge } = setup();
    const reads = views.map((view) => vi.spyOn(view.edges.geometry, 'getAttribute'));
    expect(pickNearEdge(['face'])).toMatchObject({ kind: 'face', body: A });
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it('with edges only it hits the edge and never falls back to the face', () => {
    const { pickNearEdge, pickCenter } = setup();
    expect(pickNearEdge(['edge'])).toMatchObject({ kind: 'edge' });
    expect(pickCenter(['edge'])).toBeNull();
  });

  it('an empty filter returns null without looking at the scene', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge([])).toBeNull();
    expect(pickCenter([])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });
});

describe('Picker and sketch entities', () => {
  it('a filter with only sketchEntity returns null without looking at the bodies', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge(['sketchEntity'])).toBeNull();
    expect(pickCenter(['sketchEntity'])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });

  it('sketchEntity next to body kinds does not change the body pick', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['sketchEntity', 'edge', 'face'])).toMatchObject({ kind: 'edge' });
  });
});

describe('Picker and sketch regions (M13)', () => {
  it('a filter with only sketchRegion returns null without looking at the bodies', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge(['sketchRegion'])).toBeNull();
    expect(pickCenter(['sketchRegion'])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });

  it('sketchRegion next to body kinds does not change the body pick', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['sketchRegion', 'edge', 'face'])).toMatchObject({ kind: 'edge' });
  });
});

/** Sides of the polygon that stands in for a circle in the frustum below. */
const SIDES = 8;
/** Face keys of the frustum, out of range order like the kernel's (spec 09, "Testy"). */
const FACE = { side: 4, topCap: 0, bottomCap: 2 } as const;
/** Edge keys of the frustum, out of range order as well. */
const EDGE = { seam: 2, bottomRim: 0, topRim: 1 } as const;

/**
 * A cylinder around +Z that widens upwards (a frustum): a regular SIDES-gon with apothem
 * `bottom` at z = 0 and `top` at z = `height`, so seen from +Z the top cap hides the bottom rim.
 * Side k spans the angles (2k − 1)·π/SIDES … (2k + 1)·π/SIDES, so side 0 is the chord on the line
 * x = apothem. Faces have their own vertices (spec 06): side (2 triangles per side), top cap and
 * bottom cap as fans, wound counter-clockwise seen from outside. Edges: seam (2 points), bottom
 * rim and top rim (closed polylines of SIDES + 1 points), so the body's segments are seam 0,
 * bottom rim 1…SIDES, top rim SIDES + 1…2·SIDES. The normals are smooth; the picker never reads
 * them.
 */
function aFrustumMesh(bottom: number, top: number, height: number): MeshData {
  const corner = (apothem: number, z: number, k: number): Vec3 => {
    const radius = apothem / Math.cos(Math.PI / SIDES);
    const angle = ((2 * k - 1) * Math.PI) / SIDES;
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  };
  const ring = (apothem: number, z: number): Vec3[] =>
    Array.from({ length: SIDES }, (_, k) => corner(apothem, z, k));
  const lower = ring(bottom, 0);
  const upper = ring(top, height);
  /** Vertex 2k is lower corner k, vertex 2k + 1 upper corner k. */
  const sideCorners = Array.from({ length: SIDES }, (_, k) => [
    corner(bottom, 0, k),
    corner(top, height, k),
  ]).flat();

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  /** Appends a face: its own vertices and triangles indexing them. */
  const addFace = (
    key: number,
    vertices: readonly (readonly [Vec3, Vec3])[],
    triangles: readonly (readonly [number, number, number])[],
  ): void => {
    const first = positions.length / 3;
    faceRanges.push(key, indices.length / 3, triangles.length);
    for (const [position, normal] of vertices) {
      positions.push(...position);
      normals.push(...normal);
    }
    for (const triangle of triangles) indices.push(...triangle.map((i) => first + i));
  };
  const radial = (p: Vec3): Vec3 => {
    const length = Math.hypot(p[0], p[1]);
    return [p[0] / length, p[1] / length, 0];
  };
  const fan = Array.from({ length: SIDES - 2 }, (_, i) => i + 1);

  // Side k: lower k → lower k+1 → upper k+1 → upper k, counter-clockwise seen from outside.
  addFace(
    FACE.side,
    sideCorners.map((p) => [p, radial(p)] as const),
    Array.from({ length: SIDES }, (_, k) => {
      const next = (k + 1) % SIDES;
      return [
        [2 * k, 2 * next, 2 * next + 1],
        [2 * k, 2 * next + 1, 2 * k + 1],
      ] as const;
    }).flat(),
  );
  // Angles grow counter-clockwise seen from +Z: the top cap as is, the bottom cap reversed.
  addFace(
    FACE.topCap,
    upper.map((p) => [p, [0, 0, 1]] as const),
    fan.map((k) => [0, k, k + 1] as const),
  );
  addFace(
    FACE.bottomCap,
    lower.map((p) => [p, [0, 0, -1]] as const),
    fan.map((k) => [0, k + 1, k] as const),
  );

  const closed = (points: readonly Vec3[]): Vec3[] => [...points, ...points.slice(0, 1)];
  const edges: readonly (readonly [number, readonly Vec3[]])[] = [
    [EDGE.seam, [corner(top, height, 0), corner(bottom, 0, 0)]],
    [EDGE.bottomRim, closed(lower)],
    [EDGE.topRim, closed(upper)],
  ];
  const edgePositions: number[] = [];
  const edgeRanges: number[] = [];
  for (const [key, points] of edges) {
    edgeRanges.push(key, edgePositions.length / 3, points.length);
    for (const p of points) edgePositions.push(...p);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePositions: new Float32Array(edgePositions),
    edgeRanges: new Uint32Array(edgeRanges),
  };
}

/**
 * A box far from the cursor (A, listed first, so the frustum's segments do not start at 0) and
 * the frustum C: apothem 9.5 at z = 0, 10 at z = 10. Its side 0 is the chord x = 9.5 of the
 * bottom rim (hidden under the top cap) and the chord x = 10 of the top rim, for |y| < 4.14.
 */
function frustumSetup() {
  const materials = createBodyMaterials(LIGHT_PALETTE);
  const views = [
    createBodyView(A, aBoxMesh([-40, -5, 0], [-30, 5, 10]), materials),
    createBodyView(C, aFrustumMesh(9.5, 10, 10), materials),
  ];
  const picker = createPicker({
    views: () => views,
    bounds: () => unionBounds(views.map((v) => v.bounds)),
  });
  const camera = topCamera();
  /** Picks at the world point (x, y) under the cursor, in mm. */
  return (x: number, y: number) =>
    picker.pick(camera, SIZE / 2 + 10 * x, SIZE / 2 - 10 * y, SIZE, SIZE);
}

/** Matches a point within 5e-5 mm (the mesh is Float32); asymmetric matchers are typed any. */
const near = ([x, y, z]: Vec3): unknown[] => [
  expect.closeTo(x, 4),
  expect.closeTo(y, 4),
  expect.closeTo(z, 4),
];

describe('Picker on edges of many segments', () => {
  it('returns the body, the edge key and the point on the segment of a polyline edge', () => {
    const pickAt = frustumSetup();
    // 3 px outside the top rim (x = 10) and 8 px from the bottom rim: the only candidate.
    expect(pickAt(10.3, 2)).toEqual({
      kind: 'edge',
      body: C,
      edgeIndex: EDGE.topRim,
      point: near([10, 2, 10]),
    });
  });

  it('skips a hidden edge nearer the cursor and picks the visible one after it', () => {
    const pickAt = frustumSetup();
    // 1 px from the hidden bottom rim (x = 9.5), 4 px from the visible top rim (x = 10).
    expect(pickAt(9.6, 2)).toEqual({
      kind: 'edge',
      body: C,
      edgeIndex: EDGE.topRim,
      point: near([10, 2, 10]),
    });
  });

  it('a hidden edge alone does not win over the face that hides it', () => {
    const pickAt = frustumSetup();
    // 2 px from the hidden bottom rim, 7 px from the top rim (beyond the tolerance).
    expect(pickAt(9.3, 2)).toEqual({
      kind: 'face',
      body: C,
      faceIndex: FACE.topCap,
      point: near([9.3, 2, 10]),
      normal: near([0, 0, 1]),
    });
  });
});
