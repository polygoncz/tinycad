import type { TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import { createKernelError, type Axis } from '@/kernel';
import { hasSolid, type Occt } from './occt';

// Sweeping a planar face (spec 06, "Tažení v adaptéru (M13)"): a prism and a solid of
// revolution. Internal to kernel-occt; the inputs are already checked by OcctKernelImpl.

/** Throws 'invalid-input' unless `shape` is a face (TopAbs_FACE). */
export function requireFace(oc: Occt, shape: TopoDS_Shape, op: string): void {
  if (shape.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_FACE) {
    throw createKernelError('invalid-input', `${op}: the profile is not a face`);
  }
}

/**
 * New TopoDS_Shape of the prism of `face` along the vector `shift` (d̂ · distance); the caller
 * owns it. BRepPrimAPI_MakePrism without a copy, with canonized surfaces.
 */
export function prismShape(oc: Occt, face: TopoDS_Shape, shift: Vec3): TopoDS_Shape {
  using vector = new oc.gp_Vec(shift[0], shift[1], shift[2]);
  using maker = new oc.BRepPrimAPI_MakePrism(face, vector, false, true);
  return checkedSolid(oc, maker, 'extrude');
}

/**
 * New TopoDS_Shape of `face` revolved about `axis` by `angle` radians (0 < angle ≤ 2π); the
 * caller owns it. BRepPrimAPI_MakeRevol without a copy.
 */
export function revolShape(oc: Occt, face: TopoDS_Shape, axis: Axis, angle: number): TopoDS_Shape {
  using origin = new oc.gp_Pnt(axis.origin[0], axis.origin[1], axis.origin[2]);
  using direction = new oc.gp_Dir(axis.direction[0], axis.direction[1], axis.direction[2]);
  using ax1 = new oc.gp_Ax1(origin, direction);
  using maker = new oc.BRepPrimAPI_MakeRevol(face, ax1, angle, false);
  return checkedSolid(oc, maker, 'revolve');
}

/**
 * The result of the sweep, if the algorithm is done and the result contains a valid solid;
 * otherwise 'operation-failed' (a direction in the plane of the face, an axis through it –
 * spec 06, R63). The caller owns the result.
 */
function checkedSolid(
  oc: Occt,
  maker: { IsDone(): boolean; Shape(): TopoDS_Shape },
  op: string,
): TopoDS_Shape {
  if (!maker.IsDone()) {
    throw createKernelError('operation-failed', `${op}: the algorithm failed`);
  }
  const result = maker.Shape();
  try {
    if (!hasSolid(oc, result)) {
      throw createKernelError('operation-failed', `${op}: the result has no solid`);
    }
    using analyzer = new oc.BRepCheck_Analyzer(result, true, false, false);
    if (!analyzer.IsValid()) {
      throw createKernelError('operation-failed', `${op}: the result is not valid`);
    }
  } catch (e) {
    result.delete();
    throw e;
  }
  return result;
}
