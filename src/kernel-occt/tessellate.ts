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
 * Appends the triangulation of one face with its own vertices. Nodes and normals are
 * transformed by the face location; a REVERSED face gets two vertices of every triangle
 * swapped and its normals flipped, so triangles are counter-clockwise from outside and the
 * normals point out. A face without triangles is left out of faceRanges.
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

  // Normals of the real surface at the UV of every node (GeomLib::NormEstim); where the
  // surface normal is undefined (a sphere pole) OCCT falls back to the triangle mean. They
  // are stored in the triangulation, in the frame of the surface without the face location,
  // and ignore the face orientation. Does nothing if the triangulation already has normals.
  oc.BRepLib_ToolTriangulatedShape.ComputeNormals(face, triangulation);
  if (!triangulation.HasNormals()) return;

  const base = out.positions.length / 3;
  const firstTriangle = out.indices.length / 3;
  const nodeCount = triangulation.NbNodes();
  for (let i = 1; i <= nodeCount; i++) {
    using node = triangulation.Node(i);
    const p = transformed(trsf, node.X(), node.Y(), node.Z());
    out.positions.push(p[0], p[1], p[2]);
    using normal = triangulation.Normal(i);
    // gp_Dir::Transform applies only the rotation part of the location.
    normal.Transform(trsf);
    const sign = reversed ? -1 : 1;
    out.normals.push(sign * normal.X(), sign * normal.Y(), sign * normal.Z());
  }

  for (let t = 1; t <= triangleCount; t++) {
    using triangle = triangulation.Triangle(t);
    const a = base + triangle.Value(1) - 1;
    const b = base + triangle.Value(2) - 1;
    const c = base + triangle.Value(3) - 1;
    if (reversed) out.indices.push(a, c, b);
    else out.indices.push(a, b, c);
  }
  out.faceRanges.push(faceIndex, firstTriangle, triangleCount);
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
