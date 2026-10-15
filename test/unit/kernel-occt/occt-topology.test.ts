import { beforeAll, describe, expect, it } from 'vitest';
import { mat4, type Plane, type Vec2, type Vec3 } from '@/core';
import type { ProfileCurve, ProfileLoop, ShapeResult } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M14): roles from sketch
// entity ids and the topology of real shapes, which the AABB fake cannot have.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** XZ through the origin: x → +X, y → +Z. */
const XZ: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0], direction: [0, 0, 1] } as const;

/** Closed polygon through the corners; the line from corner i has the id `l<i + 1>`. */
function polygonWithIds(...corners: Vec2[]): ProfileLoop {
  return corners.map((p, i): ProfileCurve => ({
    kind: 'line',
    from: p,
    to: corners[(i + 1) % corners.length] ?? p,
    id: `l${String(i + 1)}`,
  }));
}

const IDS = ['l1', 'l2', 'l3', 'l4'];

/** The single index of each role; fails if a role has none or more than one. */
function singleIndices(result: ShapeResult, keys: readonly string[]): number[] {
  return keys.map((key) => {
    const subs = result.roles?.[key] ?? [];
    expect(subs, key).toHaveLength(1);
    return subs[0]?.index ?? -1;
  });
}

describe('OcctKernelImpl roles from entity ids (M14)', () => {
  it('makeFace of a rectangle with four ids: four roles edge:<id> on different edges', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygonWithIds([0, 0], [4, 0], [4, 3], [0, 3]),
      holes: [],
    });
    expect(Object.keys(face.roles ?? {}).sort()).toEqual(IDS.map((id) => `edge:${id}`));
    const edges = singleIndices(
      face,
      IDS.map((id) => `edge:${id}`),
    );
    expect(new Set(edges).size).toBe(4);
    expect(face.roles?.['edge:l1']?.[0]?.type).toBe('edge');
    // The edge of l1 runs from (0, 0) to (4, 0): its midpoint is (2, 0, 0).
    const topology = await kernel.topology(face.shape);
    const midpoint = topology.edges[edges[0] ?? -1]?.midpoint ?? [0, 0, 0];
    expect(midpoint.map((c) => Math.round(c * 1e9) / 1e9)).toEqual([2, 0, 0]);
  });

  it('makeFace without ids returns no roles', async () => {
    const kernel = new OcctKernelImpl(oc);
    const outer = polygonWithIds([0, 0], [4, 0], [4, 3]).map((c): ProfileCurve =>
      c.kind === 'line' ? { kind: 'line', from: c.from, to: c.to } : c,
    );
    expect((await kernel.makeFace({ plane: XY, outer, holes: [] })).roles).toBeUndefined();
  });

  it('after transform and extrude: face:side:<id> for each line, face:start, face:end (6 faces)', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygonWithIds([0, 0], [4, 0], [4, 3], [0, 3]),
      holes: [],
    });
    const moved = await kernel.transform(face.shape, mat4.translation([0, 0, 7]));
    const prism = await kernel.extrude(moved.shape, [0, 0, 1], 5);
    const keys = [...IDS.map((id) => `face:side:${id}`), 'face:start', 'face:end'];
    expect(Object.keys(prism.roles ?? {}).sort()).toEqual([...keys].sort());
    const faces = singleIndices(prism, keys);
    expect(new Set(faces).size).toBe(6);
    // The side of l1 (y = 0) faces −Y; start is at z = 7, end at z = 12.
    const topology = await kernel.topology(prism.shape);
    const plane = (i: number) => topology.faces[faces[i] ?? -1]?.plane;
    expectClose(plane(0)?.normal, [0, -1, 0]);
    expect(plane(4)?.origin[2]).toBeCloseTo(7, 9);
    expect(plane(5)?.origin[2]).toBeCloseTo(12, 9);
  });

  it('revolve by 2π: the side roles, no start and no end', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygonWithIds([5, 0], [10, 0], [10, 10], [5, 10]),
      holes: [],
    });
    const solid = await kernel.revolve(face.shape, Z_AXIS, 2 * Math.PI);
    expect(Object.keys(solid.roles ?? {}).sort()).toEqual(IDS.map((id) => `face:side:${id}`));
    const faces = singleIndices(
      solid,
      IDS.map((id) => `face:side:${id}`),
    );
    expect(new Set(faces).size).toBe(4);
    // l1 sweeps the bottom annulus, l3 the top one: planar with outward normals.
    const topology = await kernel.topology(solid.shape);
    expectClose(topology.faces[faces[0] ?? -1]?.plane?.normal, [0, 0, -1]);
    expectClose(topology.faces[faces[2] ?? -1]?.plane?.normal, [0, 0, 1]);
  });

  it('revolve by 2π of a profile on the axis: discs and the lateral face, nothing from the axis edge', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygonWithIds([0, 0], [5, 0], [5, 10], [0, 10]),
      holes: [],
    });
    const solid = await kernel.revolve(face.shape, Z_AXIS, 2 * Math.PI);
    const keys = ['face:side:l1', 'face:side:l2', 'face:side:l3'];
    expect(Object.keys(solid.roles ?? {}).sort()).toEqual(keys);
    const [bottom, lateral, top] = singleIndices(solid, keys);
    const topology = await kernel.topology(solid.shape);
    expectClose(topology.faces[bottom ?? -1]?.plane?.normal, [0, 0, -1]);
    expect(topology.faces[lateral ?? -1]?.surface).toBe('cylinder');
    expectClose(topology.faces[top ?? -1]?.plane?.normal, [0, 0, 1]);
  });

  it('revolve by π/2: the side roles, face:start and face:end (6 faces)', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygonWithIds([5, 0], [10, 0], [10, 10], [5, 10]),
      holes: [],
    });
    const solid = await kernel.revolve(face.shape, Z_AXIS, Math.PI / 2);
    const keys = [...IDS.map((id) => `face:side:${id}`), 'face:start', 'face:end'];
    expect(Object.keys(solid.roles ?? {}).sort()).toEqual([...keys].sort());
    expect(new Set(singleIndices(solid, keys)).size).toBe(6);
  });

  it('a circle with an id: one side face, cylindrical', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: [{ kind: 'circle', center: [0, 0], radius: 2, id: 'c1' }],
      holes: [],
    });
    expect(Object.keys(face.roles ?? {})).toEqual(['edge:c1']);
    const prism = await kernel.extrude(face.shape, [0, 0, 1], 3);
    const [side] = singleIndices(prism, ['face:side:c1']);
    const topology = await kernel.topology(prism.shape);
    expect(topology.faces[side ?? -1]?.surface).toBe('cylinder');
  });

  it('a hole with an id gets its side role too', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygonWithIds([0, 0], [10, 0], [10, 10], [0, 10]),
      holes: [[{ kind: 'circle', center: [5, 5], radius: 2, id: 'hole' }]],
    });
    const prism = await kernel.extrude(face.shape, [0, 0, 1], 3);
    expect(Object.keys(prism.roles ?? {})).toContain('face:side:hole');
  });

  it('a cylinder: face:bottom lies in the base, against the axis', async () => {
    const kernel = new OcctKernelImpl(oc);
    const base: Vec3 = [1, 2, 3];
    const result = await kernel.makeCylinder({ base, axis: [0, 0, -1], radius: 2, height: 4 });
    const [bottom, top] = singleIndices(result, ['face:bottom', 'face:top']);
    const topology = await kernel.topology(result.shape);
    expect(topology.faces[bottom ?? -1]?.plane?.origin[2]).toBeCloseTo(3, 9);
    expectClose(topology.faces[bottom ?? -1]?.plane?.normal, [0, 0, 1]);
    expect(topology.faces[top ?? -1]?.plane?.origin[2]).toBeCloseTo(-1, 9);
  });
});

describe('OcctKernelImpl.topology (M14)', () => {
  it('a cylinder: a lateral face and two planes; the seam has one face, a circle one vertex', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.makeCylinder({
      base: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 2,
      height: 4,
    });
    const topology = await kernel.topology(shape);
    expect(topology.faces.map((f) => f.surface).sort()).toEqual(['cylinder', 'plane', 'plane']);
    expect(topology.faces.find((f) => f.surface === 'cylinder')?.plane).toBeUndefined();
    const shapes = topology.edges.map((e) => [e.faces.length, e.vertices.length]).sort();
    // Two circles (lateral + cap, one vertex) and the seam (lateral only, two vertices).
    expect(shapes).toEqual([
      [1, 2],
      [2, 1],
      [2, 1],
    ]);
    expect(topology.vertexCount).toBe(2);
  });

  it('a revolved profile touching the axis: degenerated edges get a finite midpoint', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygonWithIds([0, 0], [5, 0], [5, 10], [0, 10]),
      holes: [],
    });
    const { shape } = await kernel.revolve(face.shape, Z_AXIS, 2 * Math.PI);
    const topology = await kernel.topology(shape);
    for (const edge of topology.edges) expect(edge.midpoint.every(Number.isFinite)).toBe(true);
  });
});

function expectClose(actual: Vec3 | undefined, expected: Vec3): void {
  expect(actual, 'vector').toBeDefined();
  for (let k = 0; k < 3; k++) {
    expect(Math.abs((actual?.[k] ?? Number.NaN) - (expected[k] ?? Number.NaN))).toBeLessThan(1e-9);
  }
}
