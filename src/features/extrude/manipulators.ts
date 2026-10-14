import { vec3 } from '@/core';
import type { Vec3 } from '@/core';
import type {
  FeatureAnchors,
  Handle,
  ManipulatorDescriptor,
  ManipulatorFrame,
} from '@/interaction';
import { flipApplies } from './schema';
import type { ExtrudeParams } from './schema';

// The manipulator of the extrude (M18, ADR 0021): one arrow that drags the distance. It stands
// on the end face, base + d·distance; the base and the sketch normal come from the builder as
// the anchor 'base' (only for 'blind' and 'symmetric'). The direction d comes from the live
// params (spec 07, the anchor is minimal): against the normal for 'blind' with flip, else along
// it. A symmetric extrude ends half the distance in front of the sketch, so there the arrow
// drags distance/2 and the field of the HUD shows the whole distance (displayScale 2, M19). The
// frame stands at the base point; the extrude has no modes.

/** The smallest distance the arrow can drag to; the schema wants a positive distance. */
const MIN_DISTANCE = 0.01;

export const extrudeManipulators: ManipulatorDescriptor<ExtrudeParams> = Object.freeze<
  ManipulatorDescriptor<ExtrudeParams>
>({
  type: 'extrude',
  frame(params: ExtrudeParams, anchors: FeatureAnchors): ManipulatorFrame | null {
    // An anchor left from an earlier 'blind' build must not show an arrow for up to face.
    if (params.endType === 'upToFace') return null;
    const base = anchors['base'];
    if (base?.direction === undefined) return null;
    const direction: Vec3 = Object.freeze(
      flipApplies(params.endType) && params.flip ? vec3.scale(base.direction, -1) : base.direction,
    );
    const symmetric = params.endType === 'symmetric';
    const value = symmetric ? params.distance / 2 : params.distance;
    const distance: Handle = Object.freeze({
      kind: 'linear',
      id: 'distance',
      position: Object.freeze(vec3.add(base.point, vec3.scale(direction, value))),
      direction,
      value,
      unit: 'length',
      min: MIN_DISTANCE,
      tint: 'neutral',
      toParams: symmetric ? (v: number) => ({ distance: 2 * v }) : (v: number) => ({ distance: v }),
      ...(symmetric ? { displayScale: 2 } : {}),
    });
    return Object.freeze({ center: base.point, handles: Object.freeze([distance]) });
  },
});
