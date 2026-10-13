import type { TopoDS_Shape } from 'replicad-opencascadejs';
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
}

/**
 * Takes ownership of `shape` and computes its sub-shape maps. If that fails, deletes the
 * shape and the maps computed so far before rethrowing, so nothing leaks.
 */
export function createShapeEntry(oc: Occt, shape: TopoDS_Shape): ShapeEntry {
  const { TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX } = oc.TopAbs_ShapeEnum;
  const maps: (readonly TopoDS_Shape[])[] = [];
  try {
    for (const type of [TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX]) {
      maps.push(mapSubShapes(oc, shape, type));
    }
    const [faces = [], edges = [], vertices = []] = maps;
    return { shape, faces, edges, vertices };
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

function deleteAll(shapes: readonly TopoDS_Shape[]): void {
  for (const s of shapes) s.delete();
}
