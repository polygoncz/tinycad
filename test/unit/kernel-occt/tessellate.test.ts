import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GeomAbs_SurfaceType, TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import { validateMeshData, type MeshData, type MeshQuality } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { createShapeEntry, deleteShapeEntry, type ShapeEntry } from '@/kernel-occt/shape-entry';
import { tessellateEntry } from '@/kernel-occt/tessellate';

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

// Entries created by a test; deleted after it, so the tests themselves do not leak.
const entries: ShapeEntry[] = [];

afterEach(() => {
  for (const entry of entries.splice(0)) deleteShapeEntry(entry);
});

function aBoxShape(origin: Vec3, size: Vec3): TopoDS_Shape {
  using corner = new oc.gp_Pnt(origin[0], origin[1], origin[2]);
  using maker = new oc.BRepPrimAPI_MakeBox(corner, size[0], size[1], size[2]);
  return maker.Shape();
}

function anEntry(shape: TopoDS_Shape): ShapeEntry {
  const entry = createShapeEntry(oc, shape);
  entries.push(entry);
  return entry;
}

/** A box whose shape carries a non-identity location (a translation), not moved geometry. */
function aMovedBoxEntry(origin: Vec3, size: Vec3, offset: Vec3): ShapeEntry {
  using box = aBoxShape(origin, size);
  using trsf = new oc.gp_Trsf();
  using vector = new oc.gp_Vec(offset[0], offset[1], offset[2]);
  trsf.SetTranslation(vector);
  using location = new oc.TopLoc_Location(trsf);
  return anEntry(box.Moved(location, false));
}

function vertex(mesh: MeshData, i: number): Vec3 {
  return [
    mesh.positions[3 * i] ?? NaN,
    mesh.positions[3 * i + 1] ?? NaN,
    mesh.positions[3 * i + 2] ?? NaN,
  ];
}

function normal(mesh: MeshData, i: number): Vec3 {
  return [
    mesh.normals[3 * i] ?? NaN,
    mesh.normals[3 * i + 1] ?? NaN,
    mesh.normals[3 * i + 2] ?? NaN,
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Triangle indices [first, first + count) of the face, from faceRanges. */
function faceTriangles(mesh: MeshData, face: number): readonly number[] {
  for (let r = 0; r < mesh.faceRanges.length; r += 3) {
    if (mesh.faceRanges[r] === face) {
      const first = mesh.faceRanges[r + 1] ?? 0;
      const count = mesh.faceRanges[r + 2] ?? 0;
      return Array.from({ length: count }, (_, k) => first + k);
    }
  }
  return [];
}

function triangleVertices(mesh: MeshData, t: number): readonly [number, number, number] {
  return [mesh.indices[3 * t] ?? -1, mesh.indices[3 * t + 1] ?? -1, mesh.indices[3 * t + 2] ?? -1];
}

/** Geometric normal of the triangle from its winding (not normalised). */
function windingNormal(mesh: MeshData, t: number): Vec3 {
  const [a, b, c] = triangleVertices(mesh, t);
  const pa = vertex(mesh, a);
  return cross(sub(vertex(mesh, b), pa), sub(vertex(mesh, c), pa));
}

/** A cylinder of radius r and height h on the Z axis, rotated by angle about the X axis. */
function aCylinderShape(r: number, h: number, angle = 0): TopoDS_Shape {
  using maker = new oc.BRepPrimAPI_MakeCylinder(r, h);
  const cylinder = maker.Shape();
  if (angle === 0) return cylinder;
  using origin = new oc.gp_Pnt(0, 0, 0);
  using xDir = new oc.gp_Dir(1, 0, 0);
  using axis = new oc.gp_Ax1(origin, xDir);
  using trsf = new oc.gp_Trsf();
  trsf.SetRotation(axis, angle);
  using location = new oc.TopLoc_Location(trsf);
  using unrotated = cylinder;
  return unrotated.Moved(location, false);
}

/** Index of the first face of the entry whose surface has the given type. */
function faceOfType(entry: ShapeEntry, type: GeomAbs_SurfaceType): number {
  return entry.faces.findIndex((shape) => {
    using face = oc.TopoDS.Face(shape);
    using surface = new oc.BRepAdaptor_Surface(face, true);
    return surface.GetType() === type;
  });
}

/** Distinct vertex indices of the triangles of the face. */
function faceVertices(mesh: MeshData, face: number): readonly number[] {
  const result = new Set<number>();
  for (const t of faceTriangles(mesh, face))
    for (const v of triangleVertices(mesh, t)) result.add(v);
  return [...result];
}

function unitOf(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Angle between the mesh normal and the expected unit direction, in radians. */
function angleTo(n: Vec3, expected: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(unitOf(n), expected))));
}

// Float32 normals of the exact surface normal: well under a thousandth of a radian. A mean of
// triangle normals is off by about half the angular step at the seam and the face boundary.
const SURFACE_NORMAL_TOLERANCE = 1e-4;

function keys(ranges: Uint32Array): readonly number[] {
  const result: number[] = [];
  for (let r = 0; r < ranges.length; r += 3) result.push(ranges[r] ?? -1);
  return result;
}

describe('tessellateEntry', () => {
  it('meshes a box into a valid mesh with faces 0..5 and edges 0..11', () => {
    const mesh = tessellateEntry(oc, anEntry(aBoxShape([1, -2, 3], [2, 3, 4])), QUALITY);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(keys(mesh.faceRanges)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(keys(mesh.edgeRanges)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('gives every face its own vertices', () => {
    const mesh = tessellateEntry(oc, anEntry(aBoxShape([0, 0, 0], [1, 1, 1])), QUALITY);
    const owner = new Map<number, number>();
    for (let face = 0; face < 6; face++) {
      for (const t of faceTriangles(mesh, face)) {
        for (const v of triangleVertices(mesh, t)) {
          expect(owner.get(v) ?? face).toBe(face);
          owner.set(v, face);
        }
      }
    }
    // Every vertex belongs to exactly one face: a box corner appears once per adjacent face.
    expect(owner.size).toBe(mesh.positions.length / 3);
  });

  it('winds the triangles of a REVERSED face counter-clockwise from outside, normals out', () => {
    const entry = anEntry(aBoxShape([0, 0, 0], [1, 1, 1]));
    // Face 0 of MakeBox is the -X side and is REVERSED in its shell (precondition).
    const face0 = entry.faces[0];
    expect(face0?.Orientation()).toBe(oc.TopAbs_Orientation.TopAbs_REVERSED);
    const mesh = tessellateEntry(oc, entry, QUALITY);
    const outward: Vec3 = [-1, 0, 0];
    const triangles = faceTriangles(mesh, 0);
    expect(triangles.length).toBeGreaterThanOrEqual(2);
    for (const t of triangles) {
      expect(dot(windingNormal(mesh, t), outward)).toBeGreaterThan(0);
      for (const v of triangleVertices(mesh, t)) {
        const n = normal(mesh, v);
        expect(n[0]).toBeCloseTo(-1, 6);
        expect(n[1]).toBeCloseTo(0, 6);
        expect(n[2]).toBeCloseTo(0, 6);
      }
    }
  });

  it('transforms face nodes and edge points by the location of the shape', () => {
    const entry = aMovedBoxEntry([0, 0, 0], [1, 1, 1], [10, 20, 30]);
    const mesh = tessellateEntry(oc, entry, QUALITY);
    expect(validateMeshData(mesh)).toEqual([]);
    const inMovedBox = (p: ArrayLike<number>, i: number): void => {
      const lo = [10, 20, 30][i % 3] ?? NaN;
      expect(p[i]).toBeGreaterThanOrEqual(lo - 1e-5);
      expect(p[i]).toBeLessThanOrEqual(lo + 1 + 1e-5);
    };
    for (let i = 0; i < mesh.positions.length; i++) inMovedBox(mesh.positions, i);
    for (let i = 0; i < mesh.edgePositions.length; i++) inMovedBox(mesh.edgePositions, i);
  });

  it('gives the lateral face of a cylinder the surface normal: radial, outward, across the seam', () => {
    const entry = anEntry(aCylinderShape(2, 5));
    const lateral = faceOfType(entry, oc.GeomAbs_SurfaceType.GeomAbs_Cylinder);
    const mesh = tessellateEntry(oc, entry, QUALITY);
    const vertices = faceVertices(mesh, lateral);
    expect(vertices.length).toBeGreaterThan(8);
    for (const v of vertices) {
      const p = vertex(mesh, v);
      const radial = unitOf([p[0], p[1], 0]);
      expect(angleTo(normal(mesh, v), radial)).toBeLessThan(SURFACE_NORMAL_TOLERANCE);
    }
  });

  it('gives a sphere the direction from the centre, also at the poles', () => {
    using center = new oc.gp_Pnt(1, 2, 3);
    using maker = new oc.BRepPrimAPI_MakeSphere(center, 4);
    const entry = anEntry(maker.Shape());
    const mesh = tessellateEntry(oc, entry, QUALITY);
    const vertexCount = mesh.positions.length / 3;
    expect(vertexCount).toBeGreaterThan(8);
    for (let v = 0; v < vertexCount; v++) {
      const fromCenter = unitOf(sub(vertex(mesh, v), [1, 2, 3]));
      expect(angleTo(normal(mesh, v), fromCenter)).toBeLessThan(SURFACE_NORMAL_TOLERANCE);
    }
  });

  it('turns the normals of a REVERSED curved face inward (surface normal flipped)', () => {
    using cylinder = aCylinderShape(2, 5);
    const entry = anEntry(cylinder.Reversed());
    const lateral = faceOfType(entry, oc.GeomAbs_SurfaceType.GeomAbs_Cylinder);
    // Precondition: the lateral face of a reversed solid is REVERSED.
    expect(entry.faces[lateral]?.Orientation()).toBe(oc.TopAbs_Orientation.TopAbs_REVERSED);
    const mesh = tessellateEntry(oc, entry, QUALITY);
    for (const v of faceVertices(mesh, lateral)) {
      const p = vertex(mesh, v);
      const inward = unitOf([-p[0], -p[1], 0]);
      expect(angleTo(normal(mesh, v), inward)).toBeLessThan(SURFACE_NORMAL_TOLERANCE);
    }
    // The winding still agrees with the normals.
    for (const t of faceTriangles(mesh, lateral)) {
      const [a] = triangleVertices(mesh, t);
      expect(dot(windingNormal(mesh, t), normal(mesh, a))).toBeGreaterThan(0);
    }
  });

  it('rotates the normals by the location of the shape', () => {
    // Rotated by 90° about X: the cylinder axis becomes -Y, the lateral normals lie in XZ.
    const entry = anEntry(aCylinderShape(2, 5, Math.PI / 2));
    const lateral = faceOfType(entry, oc.GeomAbs_SurfaceType.GeomAbs_Cylinder);
    const mesh = tessellateEntry(oc, entry, QUALITY);
    for (const v of faceVertices(mesh, lateral)) {
      const p = vertex(mesh, v);
      const radial = unitOf([p[0], 0, p[2]]);
      expect(angleTo(normal(mesh, v), radial)).toBeLessThan(SURFACE_NORMAL_TOLERANCE);
    }
  });

  it('returns arrays that each own their whole ArrayBuffer', () => {
    const mesh = tessellateEntry(oc, anEntry(aBoxShape([0, 0, 0], [1, 1, 1])), QUALITY);
    const arrays = [
      mesh.positions,
      mesh.normals,
      mesh.indices,
      mesh.faceRanges,
      mesh.edgePositions,
      mesh.edgeRanges,
    ];
    for (const a of arrays) {
      expect(a.byteOffset).toBe(0);
      expect(a.byteLength).toBe(a.buffer.byteLength);
    }
    expect(new Set(arrays.map((a) => a.buffer)).size).toBe(arrays.length);
  });
});
