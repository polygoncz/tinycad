import type { TopoDS_Edge, TopoDS_Face, TopoDS_Shape, TopoDS_Wire } from 'replicad-opencascadejs';
import { plane as planes, type Plane, type Vec2 } from '@/core';
import { createKernelError, type ProfileCurve, type ProfileLoop } from '@/kernel';
import type { Occt } from './occt';

// Planar face from closed loops (spec 06, "Rovinná plocha v adaptéru (M12)"). Internal to
// kernel-occt; the input is already checked by validateFaceInput.

/** The input of makeFace. */
export interface FaceInput {
  readonly plane: Plane;
  readonly outer: ProfileLoop;
  readonly holes: readonly ProfileLoop[];
}

/** A fresh copy of a checked input (isolation, spec 06): nothing of `p` is kept. */
export function copyFaceInput(p: FaceInput): FaceInput {
  const vec = (v: Vec2): Vec2 => [v[0], v[1]];
  const curve = (c: ProfileCurve): ProfileCurve => {
    switch (c.kind) {
      case 'line':
        return { kind: 'line', from: vec(c.from), to: vec(c.to) };
      case 'arc':
        return { kind: 'arc', center: vec(c.center), from: vec(c.from), to: vec(c.to), ccw: c.ccw };
      case 'circle':
        return { kind: 'circle', center: vec(c.center), radius: c.radius };
    }
  };
  const loop = (l: ProfileLoop): ProfileLoop => l.map(curve);
  return {
    plane: {
      origin: [p.plane.origin[0], p.plane.origin[1], p.plane.origin[2]],
      xDir: [p.plane.xDir[0], p.plane.xDir[1], p.plane.xDir[2]],
      normal: [p.plane.normal[0], p.plane.normal[1], p.plane.normal[2]],
    },
    outer: loop(p.outer),
    holes: p.holes.map(loop),
  };
}

/**
 * New TopoDS_Shape of the face; the caller owns it. gp_Pln with the frame of the plane, edges
 * built in space, wires by BRepBuilderAPI_MakeWire, the face by BRepBuilderAPI_MakeFace with
 * the holes added, then ShapeFix_Face.FixOrientation (orients the holes). A wire that does not
 * close or a face BRepCheck_Analyzer finds invalid (a self-intersecting loop) is
 * 'operation-failed'.
 */
export function faceShape(oc: Occt, input: FaceInput): TopoDS_Shape {
  const { plane } = input;
  using origin = point(oc, plane, [0, 0]);
  using normal = new oc.gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]);
  using xDir = new oc.gp_Dir(plane.xDir[0], plane.xDir[1], plane.xDir[2]);
  using frame = new oc.gp_Ax3(origin, normal, xDir);
  using pln = new oc.gp_Pln(frame);

  using outer = wire(oc, plane, input.outer);
  using maker = new oc.BRepBuilderAPI_MakeFace(pln, outer, true);
  for (const loop of input.holes) {
    using hole = wire(oc, plane, loop);
    maker.Add(hole);
  }
  if (!maker.IsDone()) {
    throw createKernelError('operation-failed', 'makeFace: the face could not be built');
  }
  using face = maker.Face();
  using fix = new oc.ShapeFix_Face(face);
  // FixOrientation, not Perform: Perform alone leaves a hole with the orientation of the outer
  // wire, which BRepCheck_Analyzer rejects (checked on a square with a circular hole).
  fix.FixOrientation();
  const fixed: TopoDS_Face = fix.Face();
  try {
    using analyzer = new oc.BRepCheck_Analyzer(fixed, true, false, false);
    if (!analyzer.IsValid()) {
      throw createKernelError('operation-failed', 'makeFace: the face is not valid');
    }
  } catch (e) {
    fixed.delete();
    throw e;
  }
  return fixed;
}

/** New wire of the loop; the caller owns it. */
function wire(oc: Occt, plane: Plane, loop: ProfileLoop): TopoDS_Wire {
  using maker = new oc.BRepBuilderAPI_MakeWire();
  for (const c of loop) {
    using e = edge(oc, plane, c);
    maker.Add(e);
  }
  if (!maker.IsDone()) {
    throw createKernelError('operation-failed', 'makeFace: a loop does not form a wire');
  }
  return maker.Wire();
}

/** New edge of the curve in space; the caller owns it. */
function edge(oc: Occt, plane: Plane, c: ProfileCurve): TopoDS_Edge {
  switch (c.kind) {
    case 'line': {
      using from = point(oc, plane, c.from);
      using to = point(oc, plane, c.to);
      using maker = new oc.BRepBuilderAPI_MakeEdge(from, to);
      return done(maker).Edge();
    }
    case 'arc': {
      const radius = Math.hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]);
      using circle = circleOf(oc, plane, c.center, radius);
      using from = point(oc, plane, c.from);
      using to = point(oc, plane, c.to);
      // An OCCT circle runs counter-clockwise about the normal: a clockwise arc is the
      // counter-clockwise arc from `to` to `from`.
      using maker = c.ccw
        ? new oc.BRepBuilderAPI_MakeEdge(circle, from, to)
        : new oc.BRepBuilderAPI_MakeEdge(circle, to, from);
      return done(maker).Edge();
    }
    case 'circle': {
      using circle = circleOf(oc, plane, c.center, c.radius);
      using maker = new oc.BRepBuilderAPI_MakeEdge(circle);
      return done(maker).Edge();
    }
  }
}

function done<M extends { IsDone(): boolean }>(maker: M): M {
  if (!maker.IsDone()) {
    throw createKernelError('operation-failed', 'makeFace: an edge could not be built');
  }
  return maker;
}

/** New gp_Circ in the plane: centre `center`, axis = plane normal, x axis = plane xDir. */
function circleOf(oc: Occt, plane: Plane, center: Vec2, radius: number) {
  using c = point(oc, plane, center);
  using normal = new oc.gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]);
  using xDir = new oc.gp_Dir(plane.xDir[0], plane.xDir[1], plane.xDir[2]);
  using axes = new oc.gp_Ax2(c, normal, xDir);
  return new oc.gp_Circ(axes, radius);
}

/** New gp_Pnt of the plane point v. */
function point(oc: Occt, plane: Plane, v: Vec2) {
  const w = planes.toWorld(plane, v);
  return new oc.gp_Pnt(w[0], w[1], w[2]);
}
