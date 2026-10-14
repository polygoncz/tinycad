import type { TopoDS_Shape } from 'replicad-opencascadejs';
import type { ShapeResult } from '@/kernel';
import { mapSubShapes, type Occt } from './occt';

// What the adapter keeps per handle. Internal to kernel-occt.

/**
 * What the adapter keeps per handle (spec 06, "Data structures on both sides"). The sub-shape
 * maps are computed once when the shape is created; the position in a map is the
 * SubShapeIndex, stable for the handle. The entry owns every OCCT object in it.
 */
export interface ShapeEntry {
  readonly shape: TopoDS_Shape;
  readonly faces: readonly TopoDS_Shape[];
  readonly edges: readonly TopoDS_Shape[];
  readonly vertices: readonly TopoDS_Shape[];
  /**
   * Edge index → id of the sketch entity the edge was made from (spec 06, M14): set by makeFace,
   * carried over by transform, read by extrude and revolve for the roles face:side:<id>.
   */
  readonly edgeRoles: ReadonlyMap<number, string>;
}

/** What a new shape gets besides its sub-shape maps (M14). */
export interface EntryDescription {
  /** The edge roles of the entry, from its edge map. */
  readonly edgeRoles?: (edges: readonly TopoDS_Shape[]) => ReadonlyMap<number, string>;
  /** Roles and history of the result, from the finished entry. */
  readonly describe?: (entry: ShapeEntry) => Omit<ShapeResult, 'shape'>;
}

/**
 * Takes ownership of `shape`, stores it under a new handle and returns the result with its
 * roles and history. Helpers outside OcctKernelImpl build shapes with it while their OCCT
 * algorithm is still alive (the history needs it).
 */
export type AddShape = (shape: TopoDS_Shape, description?: EntryDescription) => ShapeResult;

const NO_EDGE_ROLES: ReadonlyMap<number, string> = new Map();

/**
 * Takes ownership of `shape` and computes its sub-shape maps and edge roles. If that fails,
 * deletes the shape and the maps computed so far before rethrowing, so nothing leaks.
 */
export function createShapeEntry(
  oc: Occt,
  shape: TopoDS_Shape,
  edgeRolesOf?: (edges: readonly TopoDS_Shape[]) => ReadonlyMap<number, string>,
): ShapeEntry {
  const { TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX } = oc.TopAbs_ShapeEnum;
  const maps: (readonly TopoDS_Shape[])[] = [];
  try {
    for (const type of [TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX]) {
      maps.push(mapSubShapes(oc, shape, type));
    }
    const [faces = [], edges = [], vertices = []] = maps;
    const edgeRoles = edgeRolesOf?.(edges) ?? NO_EDGE_ROLES;
    return { shape, faces, edges, vertices, edgeRoles };
  } catch (e) {
    for (const map of maps) deleteAll(map);
    shape.delete();
    throw e;
  }
}

/** Deletes every OCCT object the entry owns. */
export function deleteShapeEntry(entry: ShapeEntry): void {
  deleteAll(entry.faces);
  deleteAll(entry.edges);
  deleteAll(entry.vertices);
  entry.shape.delete();
}

/** Position of the sub-shape IsSame as `shape` in the map, or -1. */
export function indexOfSame(map: readonly TopoDS_Shape[], shape: TopoDS_Shape): number {
  return map.findIndex((s) => s.IsSame(shape));
}

function deleteAll(shapes: readonly TopoDS_Shape[]): void {
  for (const s of shapes) s.delete();
}
