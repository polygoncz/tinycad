// The plane reference of a sketch feature (spec 12, "Featura skici"): the first item of the param
// SKETCH_PARAM.plane, an origin plane or a planar face (M14). Shared by the SketchEditor (create,
// edit) and the SketchSession (a plane changed while sketching, M21). Internal to sketcher.

import { readPlaneRef } from '@/document';
import type { PlaneRef, TopoRef } from '@/document';
import { SKETCH_PARAM } from '@/sketch';

/**
 * The first item of the param SKETCH_PARAM.plane as a PlaneRef or a TopoRef (M14), or undefined
 * when it is neither (readPlaneRef of document).
 */
export function planeRefOf(
  params: Readonly<Record<string, unknown>>,
): PlaneRef | TopoRef | undefined {
  return readPlaneRef(params[SKETCH_PARAM.plane]);
}

/** A frozen copy with only the fields of its kind, never shared with the caller. */
export function frozenRef(ref: PlaneRef | TopoRef): PlaneRef | TopoRef {
  return ref.kind === 'plane'
    ? Object.freeze({ kind: 'plane', plane: ref.plane })
    : Object.freeze({ kind: 'topo', body: ref.body, name: ref.name });
}
