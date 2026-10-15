import { mat4, vec3 } from '@/core';
import type { Mat4, Vec3 } from '@/core';
import type {
  AngularHandle,
  Handle,
  ManipulatorDescriptor,
  ManipulatorFrame,
  ManipulatorMode,
  Patch,
} from '@/interaction';
import { AXIS, inverseRotationOf, rotationOf } from './builder';
import type { TransformAnchors } from './builder';
import type { TransformParams } from './schema';

// The manipulator of the transform (M18, ADR 0021; M19 in the style of Fusion, ADR 0022). All
// handles stand where the pivot ends up, c = p + translate, which is also the center of the
// frame. The pivot p comes from the live params (the origin or pivotPoint), only the center of
// the bodies comes from the builder as the anchor 'pivot' (spec 07, the anchor is minimal).
//
// - Move (free, move): arrows, squares and the center point drag translate along the world axes.
// - Rotate (free as quarter circles, rotate as full circles): one arc per angle, in the gimbal
//   frame of R = Rz · Ry · Rx, so that dragging an arc turns the result exactly about it.
// - Pivot: the same glyphs as the move, dashed, drag c through the pivot lens: the pivot moves
//   and the body stays where it is.

const MODES: readonly ManipulatorMode[] = Object.freeze([
  Object.freeze({ id: 'free', label: 'transform.mode.free', icon: 'arrows-move' }),
  Object.freeze({ id: 'move', label: 'transform.mode.move', icon: 'arrows-up-down' }),
  Object.freeze({ id: 'rotate', label: 'transform.mode.rotate', icon: 'rotate-clockwise' }),
  Object.freeze({
    id: 'pivot',
    label: 'transform.mode.pivot',
    icon: 'focus-2',
    picksPoint: true,
  }),
]);

const AXES = Object.freeze(['x', 'y', 'z'] as const);

/** The squares: the components of u and v, and the axis of the normal (the tint). */
const PLANES = Object.freeze([
  Object.freeze({ id: 'xy', u: 0, v: 1, tint: 'z' }),
  Object.freeze({ id: 'yz', u: 1, v: 2, tint: 'x' }),
  Object.freeze({ id: 'zx', u: 2, v: 0, tint: 'y' }),
] as const);

export const transformManipulators: ManipulatorDescriptor<TransformParams, TransformAnchors> =
  Object.freeze<ManipulatorDescriptor<TransformParams, TransformAnchors>>({
    type: 'transform',
    modes: MODES,
    frame(
      params: TransformParams,
      anchors: TransformAnchors,
      mode: string,
    ): ManipulatorFrame | null {
      const p = pivotOf(params, anchors);
      if (p === undefined) return null;
      const c: Vec3 = Object.freeze(vec3.add(p, params.translate));
      const handles = handlesOf(params, p, c, mode);
      if (handles === null) return null;
      return Object.freeze({ center: c, handles: Object.freeze(handles) });
    },
    pickPoint(
      params: TransformParams,
      anchors: TransformAnchors,
      mode: string,
      point: Vec3,
    ): Patch | null {
      if (mode !== 'pivot') return null;
      const p = pivotOf(params, anchors);
      if (p === undefined) return null;
      return pivotLens(params, p, point);
    },
  });

/** The handles of the mode; null for a mode the transform does not have. */
function handlesOf(params: TransformParams, p: Vec3, c: Vec3, mode: string): Handle[] | null {
  const { translate } = params;
  const moveHandles = () =>
    translationHandles('t', c, translate, false, (t) => ({ translate: [t[0], t[1], t[2]] }));
  switch (mode) {
    case 'free':
      return [...moveHandles(), ...rotationHandles(params, c, 'quarter')];
    case 'move':
      return moveHandles();
    case 'rotate':
      return rotationHandles(params, c, 'full');
    case 'pivot':
      return translationHandles('p', c, c, true, (next) => pivotLens(params, p, next));
    default:
      return null;
  }
}

/**
 * Arrows, squares and the center point at c along the world axes. They show the components of
 * value and write a whole new value through toParams (translate for the move, c for the pivot).
 */
function translationHandles(
  prefix: string,
  c: Vec3,
  shown: Vec3,
  dashed: boolean,
  toParams: (next: Vec3) => Patch,
): Handle[] {
  const style = dashed ? { dashed: true } : {};
  // A frozen copy: the handles and their vectors are frozen whatever the params are.
  const value: Vec3 = Object.freeze<Vec3>([shown[0], shown[1], shown[2]]);
  const arrows = AXES.map((k, i): Handle =>
    Object.freeze({
      kind: 'linear',
      id: `${prefix}${k}`,
      position: c,
      direction: AXIS[k],
      value: value[i] ?? 0,
      unit: 'length',
      tint: k,
      ...style,
      toParams: (v: number) => toParams(withComponents(value, [[i, v]])),
    }),
  );
  const squares = PLANES.map((plane): Handle =>
    Object.freeze({
      kind: 'planar',
      id: `${prefix}${plane.id}`,
      origin: c,
      u: AXIS[AXES[plane.u]],
      v: AXIS[AXES[plane.v]],
      value: Object.freeze([value[plane.u], value[plane.v]] as const),
      unit: 'length',
      tint: plane.tint,
      ...style,
      toParams: ([a, b]: readonly [number, number]) =>
        toParams(
          withComponents(value, [
            [plane.u, a],
            [plane.v, b],
          ]),
        ),
    }),
  );
  const center: Handle = Object.freeze({
    kind: 'point',
    id: `${prefix}c`,
    position: c,
    value,
    unit: 'length',
    tint: 'neutral',
    ...style,
    toParams,
  });
  return [...arrows, ...squares, center];
}

/**
 * The arcs rx, ry, rz in the gimbal frame of R = Rz · Ry · Rx. Changing rz turns the result
 * about Z; changing ry turns it about Rz·Y, changing rx about Rz·Ry·X (the outer angles turn the
 * axes of the inner ones). zero turns with the outer angles as well, so the arc stays on its ring.
 */
function rotationHandles(
  params: TransformParams,
  c: Vec3,
  extent: AngularHandle['extent'],
): Handle[] {
  const rz = mat4.rotationAxisAngle(AXIS.z, params.rz);
  const rzy = mat4.multiply(rz, mat4.rotationAxisAngle(AXIS.y, params.ry));
  const arc = (k: 'x' | 'y' | 'z', axis: Vec3, zero: Vec3): Handle =>
    Object.freeze({
      kind: 'angular',
      id: `r${k}`,
      center: c,
      axis: Object.freeze(axis),
      zero: Object.freeze(zero),
      extent,
      value: params[`r${k}`],
      unit: 'angle',
      tint: k,
      toParams: (v: number) => ({ [`r${k}`]: v }),
    });
  return [
    arc('x', rotate(rzy, AXIS.x), rotate(rzy, AXIS.y)),
    arc('y', rotate(rz, AXIS.y), rotate(rz, AXIS.z)),
    arc('z', AXIS.z, AXIS.x),
  ];
}

/**
 * The pivot lens: moves the pivot so that c goes to next and the body stays where it is. With
 * c' − c = R(p' − p) the pivot is p' = p + R⁻¹(c' − c); the translation that keeps
 * T(t) · T(p) · R · T(−p) the same is t' = t + (I − R)(p − p').
 */
function pivotLens(params: TransformParams, p: Vec3, next: Vec3): Patch {
  const c = vec3.add(p, params.translate);
  const pivotPoint = vec3.add(p, rotate(inverseRotationOf(params), vec3.sub(next, c)));
  const back = vec3.sub(p, pivotPoint);
  const translate = vec3.add(params.translate, vec3.sub(back, rotate(rotationOf(params), back)));
  return { pivot: 'point', pivotPoint, translate };
}

/** R · v for a pure rotation R: as a point, because R has no translation part. */
function rotate(r: Mat4, v: Vec3): Vec3 {
  return mat4.transformPoint(r, v);
}

const ORIGIN: Vec3 = Object.freeze<Vec3>([0, 0, 0]);

/** The pivot p of the builder; undefined for 'bodiesCenter' before the first good build. */
function pivotOf(params: TransformParams, anchors: TransformAnchors): Vec3 | undefined {
  switch (params.pivot) {
    case 'origin':
      return ORIGIN;
    case 'point':
      return params.pivotPoint;
    case 'bodiesCenter':
      return anchors.pivot?.point;
  }
}

/** A copy of v with the given components replaced. */
function withComponents(v: Vec3, changes: readonly (readonly [number, number])[]): Vec3 {
  const out: [number, number, number] = [v[0], v[1], v[2]];
  for (const [i, value] of changes) out[i] = value;
  return out;
}
