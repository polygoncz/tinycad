import { vec3 } from '@/core';
import type { Vec3 } from '@/core';
import type { FeatureAnchors, Handle, ManipulatorDescriptor } from '@/interaction';
import { AXIS } from './builder';
import type { TransformParams } from './schema';

// The manipulator of the transform (M18, ADR 0021): three arrows that drag the components of
// translate and three rings that set the axis and the angle. All of them stand where the pivot
// ends up, pivot + translate. The pivot comes from the live params (the origin or pivotPoint),
// only the center of the bodies comes from the builder as the anchor 'pivot' (spec 07, the
// anchor is minimal).

const AXES: readonly TransformParams['axis'][] = Object.freeze(['x', 'y', 'z'] as const);

/** The direction a ring measures its angle from: X → Y, Y → Z, Z → X. */
const ZERO: Readonly<Record<TransformParams['axis'], Vec3>> = Object.freeze({
  x: AXIS.y,
  y: AXIS.z,
  z: AXIS.x,
});

export const transformManipulators: ManipulatorDescriptor<TransformParams> = Object.freeze<
  ManipulatorDescriptor<TransformParams>
>({
  type: 'transform',
  handles(params: TransformParams, anchors: FeatureAnchors): readonly Handle[] {
    const p = pivotOf(params, anchors);
    if (p === undefined) return Object.freeze([]);
    const { translate, axis, angle } = params;
    const c = Object.freeze(vec3.add(p, translate));
    const arrows = AXES.map((k, i): Handle =>
      Object.freeze({
        kind: 'linear',
        id: `t${k}`,
        position: c,
        direction: AXIS[k],
        value: translate[i] ?? 0,
        unit: 'length',
        tint: k,
        toParams: (v: number) => ({ translate: withComponent(translate, i, v) }),
      }),
    );
    // Dragging a ring of another axis switches to it and starts from 0: one rotation only.
    const rings = AXES.map((k): Handle =>
      Object.freeze({
        kind: 'angular',
        id: `r${k}`,
        center: c,
        axis: AXIS[k],
        zero: ZERO[k],
        value: axis === k ? angle : 0,
        unit: 'angle',
        tint: k,
        toParams: (v: number) => ({ axis: k, angle: v }),
      }),
    );
    return Object.freeze([...arrows, ...rings]);
  },
});

const ORIGIN: Vec3 = Object.freeze<Vec3>([0, 0, 0]);

/** The pivot p of the builder; undefined for 'bodiesCenter' before the first good build. */
function pivotOf(params: TransformParams, anchors: FeatureAnchors): Vec3 | undefined {
  switch (params.pivot) {
    case 'origin':
      return ORIGIN;
    case 'point':
      return params.pivotPoint;
    case 'bodiesCenter':
      return anchors['pivot']?.point;
  }
}

/** A copy of v with component i replaced. */
function withComponent(v: Vec3, i: number, value: number): Vec3 {
  return [i === 0 ? value : v[0], i === 1 ? value : v[1], i === 2 ? value : v[2]];
}
