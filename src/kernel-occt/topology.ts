import type { GeomAbs_SurfaceType, TopAbs_ShapeEnum, TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import type { EdgeInfo, FaceInfo, SurfaceType, TopologySummary } from '@/kernel';
import type { Occt } from './occt';
import { indexOfSame, type ShapeEntry } from './shape-entry';

// Topology of a shape for naming (spec 06, "Historie, role a topologie v adaptéru (M14)").
// Internal to kernel-occt.

/**
 * Faces, edges and vertex count of the entry, in the order of its sub-shape maps (the indices
 * of the mesh). Adjacency edge → faces through TopExp_Explorer and IsSame (the build has no
 * TopExp::MapShapesAndAncestors), O(F · E).
 */
export function topologyOf(oc: Occt, entry: ShapeEntry): TopologySummary {
  const adjacent = entry.edges.map(() => new Set<number>());
  entry.faces.forEach((face, f) => {
    forEachSub(oc, face, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (edge) => {
      adjacent[indexOfSame(entry.edges, edge)]?.add(f);
    });
  });
  const faces = entry.faces.map((face) => faceInfo(oc, face));
  const edges = entry.edges.map((edge, e): EdgeInfo => ({
    faces: ascending(adjacent[e] ?? new Set()),
    vertices: edgeVertices(oc, entry, edge),
    midpoint: midpointOf(oc, edge),
  }));
  return { faces, edges, vertexCount: entry.vertices.length };
}

/** Surface type of the face; for a plane its point and the normal out of the solid. */
function faceInfo(oc: Occt, shape: TopoDS_Shape): FaceInfo {
  using face = oc.TopoDS.Face(shape);
  using surface = new oc.BRepAdaptor_Surface(face, true);
  const surfaceType = surfaceTypeOf(oc, surface.GetType());
  if (surfaceType !== 'plane') return { surface: surfaceType };
  using pln = surface.Plane();
  using location = pln.Location();
  using axis = pln.Axis();
  using direction = axis.Direction();
  // The surface normal is XDir × YDir of the plane frame: the axis direction for a right-handed
  // frame, its opposite for a left-handed one (gp_Pln.Direct). A reversed face points against
  // the normal of its surface.
  const handed = pln.Direct() ? 1 : -1;
  const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  const sign = handed * reversed;
  return {
    surface: 'plane',
    plane: {
      origin: [location.X(), location.Y(), location.Z()],
      normal: [sign * direction.X(), sign * direction.Y(), sign * direction.Z()],
    },
  };
}

function surfaceTypeOf(oc: Occt, type: GeomAbs_SurfaceType): SurfaceType {
  const { GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus } =
    oc.GeomAbs_SurfaceType;
  switch (type) {
    case GeomAbs_Plane:
      return 'plane';
    case GeomAbs_Cylinder:
      return 'cylinder';
    case GeomAbs_Cone:
      return 'cone';
    case GeomAbs_Sphere:
      return 'sphere';
    case GeomAbs_Torus:
      return 'torus';
    default:
      return 'other';
  }
}

/** Indices of the end vertices of the edge, ascending without duplicates. */
function edgeVertices(oc: Occt, entry: ShapeEntry, edge: TopoDS_Shape): readonly number[] {
  const found = new Set<number>();
  forEachSub(oc, edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, (vertex) => {
    const index = indexOfSame(entry.vertices, vertex);
    if (index >= 0) found.add(index);
  });
  return ascending(found);
}

/**
 * The point at the middle of the parameter range of the edge (BRepAdaptor_Curve). A degenerated
 * edge (the pole of a revolved profile touching the axis) has no 3D curve: its vertex instead.
 */
function midpointOf(oc: Occt, shape: TopoDS_Shape): Vec3 {
  using edge = oc.TopoDS.Edge(shape);
  if (oc.BRep_Tool.Degenerated(edge)) {
    using explorer = new oc.TopExp_Explorer(
      edge,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    if (!explorer.More()) return [Number.NaN, Number.NaN, Number.NaN];
    using current = explorer.Current();
    using vertex = oc.TopoDS.Vertex(current);
    using p = oc.BRep_Tool.Pnt(vertex);
    return [p.X(), p.Y(), p.Z()];
  }
  using curve = new oc.BRepAdaptor_Curve(edge);
  using p = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
  return [p.X(), p.Y(), p.Z()];
}

/** Calls `visit` with every sub-shape of the type (TopExp_Explorer, repeats included). */
function forEachSub(
  oc: Occt,
  shape: TopoDS_Shape,
  type: TopAbs_ShapeEnum,
  visit: (sub: TopoDS_Shape) => void,
): void {
  using explorer = new oc.TopExp_Explorer(shape, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (explorer.More()) {
    using current = explorer.Current();
    visit(current);
    explorer.Next();
  }
}

function ascending(set: ReadonlySet<number>): readonly number[] {
  return [...set].sort((a, b) => a - b);
}
