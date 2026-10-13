import type { gp_Trsf, TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import type { MeshData, MeshQuality } from '@/kernel';
import type { Occt } from './occt';
import type { ShapeEntry } from './shape-entry';

// Tessellation in the adapter (spec 06, "Tessellation in the adapter"): BRepMesh, then the
// triangulation of every face and the polygon of every edge copied into flat typed arrays.
// Internal to kernel-occt.

/** Plain growable arrays the mesh is collected into before the copy to typed arrays. */
interface MeshBuilder {
  readonly positions: number[];
  readonly normals: number[];
  readonly indices: number[];
  readonly faceRanges: number[];
  readonly edgePositions: number[];
  readonly edgeRanges: number[];
}

/**
 * Meshes the shape of the entry (BRepMesh stores the triangulation in the shape) and reads
 * the mesh out. The quality must already be validated. Faces and edges go in the order of the
 * sub-shape maps, so faceIndex / edgeIndex is the SubShapeIndex. Every call returns new
 * typed arrays, each with its own ArrayBuffer.
 */
export function tessellateEntry(oc: Occt, entry: ShapeEntry, q: MeshQuality): MeshData {
  // Absolute deflection, not in parallel: the worker has one thread. The constructor does
  // the meshing; the object itself is not needed afterwards.
  new oc.BRepMesh_IncrementalMesh(
    entry.shape,
    q.linearDeflection,
    false,
    q.angularDeflection,
    false,
  ).delete();
  const out: MeshBuilder = {
    positions: [],
    normals: [],
    indices: [],
    faceRanges: [],
    edgePositions: [],
    edgeRanges: [],
  };
  entry.faces.forEach((face, faceIndex) => {
    appendFace(oc, face, faceIndex, out);
  });
  entry.edges.forEach((edge, edgeIndex) => {
    appendEdge(oc, edge, edgeIndex, out);
  });
  // Typed arrays built from plain arrays: each gets a new ArrayBuffer of its exact size.
  return {
    positions: new Float32Array(out.positions),
    normals: new Float32Array(out.normals),
    indices: new Uint32Array(out.indices),
    faceRanges: new Uint32Array(out.faceRanges),
    edgePositions: new Float32Array(out.edgePositions),
    edgeRanges: new Uint32Array(out.edgeRanges),
  };
}

/**
 * Appends the triangulation of one face with its own vertices. Nodes are transformed by the
 * face location; a REVERSED face gets two vertices of every triangle swapped, so triangles
 * are counter-clockwise from outside. A face without triangles is left out of faceRanges.
 */
function appendFace(oc: Occt, shape: TopoDS_Shape, faceIndex: number, out: MeshBuilder): void {
  using face = oc.TopoDS.Face(shape);
  using location = new oc.TopLoc_Location();
  using triangulation = orNull(oc.BRep_Tool.Triangulation(face, location, 0));
  if (triangulation === null) return;
  const triangleCount = triangulation.NbTriangles();
  if (triangleCount === 0) return;
  using trsf = location.Transformation();
  const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;

  const nodeCount = triangulation.NbNodes();
  const points: Vec3[] = [];
  for (let i = 1; i <= nodeCount; i++) {
    using node = triangulation.Node(i);
    points.push(transformed(trsf, node.X(), node.Y(), node.Z()));
  }

  // Triangles as 0-based node indices, already in the outward winding.
  const triangles: (readonly [number, number, number])[] = [];
  for (let t = 1; t <= triangleCount; t++) {
    using triangle = triangulation.Triangle(t);
    const a = triangle.Value(1) - 1;
    const b = triangle.Value(2) - 1;
    const c = triangle.Value(3) - 1;
    triangles.push(reversed ? [a, c, b] : [a, b, c]);
  }

  const normals = nodeNormals(points, triangles);
  if (normals === undefined) return;

  const base = out.positions.length / 3;
  const firstTriangle = out.indices.length / 3;
  for (const p of points) out.positions.push(p[0], p[1], p[2]);
  for (const n of normals) out.normals.push(n[0], n[1], n[2]);
  for (const [a, b, c] of triangles) out.indices.push(base + a, base + b, base + c);
  out.faceRanges.push(faceIndex, firstTriangle, triangleCount);
}

/**
 * Normal per node: the mean of the unit normals of the face triangles at the node,
 * normalised (spec 06; a planar face gets the face normal). The winding is already outward,
 * so the normals point out. A node with no non-degenerate triangle gets the mean normal of
 * the whole face; undefined if even that is zero (only degenerate triangles).
 */
function nodeNormals(
  points: readonly Vec3[],
  triangles: readonly (readonly [number, number, number])[],
): readonly Vec3[] | undefined {
  const sums: Vec3[] = points.map(() => [0, 0, 0]);
  let faceSum: Vec3 = [0, 0, 0];
  for (const [a, b, c] of triangles) {
    const pa = points[a];
    const pb = points[b];
    const pc = points[c];
    if (pa === undefined || pb === undefined || pc === undefined) continue;
    const n = unit(cross(sub(pb, pa), sub(pc, pa)));
    if (n === undefined) continue;
    for (const v of [a, b, c]) {
      const sum = sums[v];
      if (sum !== undefined) sums[v] = add(sum, n);
    }
    faceSum = add(faceSum, n);
  }
  const faceNormal = unit(faceSum);
  if (faceNormal === undefined) return undefined;
  return sums.map((sum) => unit(sum) ?? faceNormal);
}

/**
 * Appends the polyline of one edge. BRep_Tool.PolygonOnTriangulation picks the polygon on
 * the triangulation of a face adjacent to the edge; its nodes are indices into that
 * triangulation and the returned location places them. A degenerated edge or an edge
 * without a polygon is left out of edgeRanges.
 */
function appendEdge(oc: Occt, shape: TopoDS_Shape, edgeIndex: number, out: MeshBuilder): void {
  using edge = oc.TopoDS.Edge(shape);
  if (oc.BRep_Tool.Degenerated(edge)) return;
  using location = new oc.TopLoc_Location();
  // Disposing the result deletes both handles in it (P and T).
  using onTriangulation = oc.BRep_Tool.PolygonOnTriangulation(edge, location);
  const polygon = orNull(onTriangulation.P);
  const triangulation = orNull(onTriangulation.T);
  if (polygon === null || triangulation === null) return;
  const pointCount = polygon.NbNodes();
  if (pointCount < 2) return;
  using trsf = location.Transformation();

  const firstPoint = out.edgePositions.length / 3;
  for (let i = 1; i <= pointCount; i++) {
    using node = triangulation.Node(polygon.Node(i));
    const p = transformed(trsf, node.X(), node.Y(), node.Z());
    out.edgePositions.push(p[0], p[1], p[2]);
  }
  out.edgeRanges.push(edgeIndex, firstPoint, pointCount);
}

/**
 * The bindings return a null OCCT handle (no triangulation, no polygon) as JS null, although
 * the declarations say the class. This widens the type so the null check is honest.
 */
function orNull<T>(value: T): T | null {
  return value;
}

/** The point transformed without allocating an OCCT object (gp_Trsf::Transforms on doubles). */
function transformed(trsf: gp_Trsf, x: number, y: number, z: number): Vec3 {
  const { theX, theY, theZ } = trsf.Transforms(x, y, z);
  return [theX, theY, theZ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The vector scaled to length 1, or undefined for a zero (or non-finite) vector. */
function unit(v: Vec3): Vec3 | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0 && Number.isFinite(length))) return undefined;
  return [v[0] / length, v[1] / length, v[2] / length];
}
