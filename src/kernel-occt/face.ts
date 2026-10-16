import type { TopoDS_Edge, TopoDS_Face, TopoDS_Shape, TopoDS_Wire } from 'replicad-opencascadejs';
import { plane as planes, type Plane, type Vec2 } from '@/core';
import {
  createKernelError,
  type ProfileCurve,
  type ProfileLoop,
  type ShapeResult,
  type SubShapeIndex,
} from '@/kernel';
import type { Occt } from './occt';
import { indexOfSame, type AddShape } from './shape-entry';

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
        return { kind: 'line', from: vec(c.from), to: vec(c.to), ...idOf(c) };
      case 'arc': {
        const { ccw } = c;
        return {
          kind: 'arc',
          center: vec(c.center),
          from: vec(c.from),
          to: vec(c.to),
          ccw,
          ...idOf(c),
        };
      }
      case 'circle':
        return { kind: 'circle', center: vec(c.center), radius: c.radius, ...idOf(c) };
      case 'bspline':
        return {
          kind: 'bspline',
          degree: c.degree,
          poles: c.poles.map(vec),
          knots: [...c.knots],
          ...idOf(c),
        };
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

/** The entity id of the curve (M14) as a property bag to spread into a copy. */
function idOf(c: ProfileCurve): { readonly id?: string } {
  return c.id === undefined ? {} : { id: c.id };
}

/** An edge of the face built from a curve with an entity id; the holder owns the edge. */
interface IdEdge {
  readonly edge: TopoDS_Edge;
  readonly id: string;
}

/**
 * The face of the input stored through `add`, with the role edge:<id> for every edge built
 * from a curve with an id (spec 06, M14). The entry keeps the same map (index → id) as its
 * edge roles, which transform carries over and extrude/revolve turn into face:side:<id>.
 */
export function faceResult(oc: Occt, input: FaceInput, add: AddShape): ShapeResult {
  const idEdges: IdEdge[] = [];
  try {
    const face = faceShape(oc, input, idEdges);
    return add(face, {
      edgeRoles: (edges) => edgeRolesOf(edges, idEdges),
      describe: (entry) => {
        const roles = edgeRoleKeys(entry.edgeRoles);
        return roles === undefined ? {} : { roles };
      },
    });
  } finally {
    for (const { edge } of idEdges) edge.delete();
  }
}

/**
 * Edge index → id: each edge of the face IsSame as an edge built with an id. The wires keep
 * the edges BRepBuilderAPI_MakeWire returned (MakeWire.Edge() after each Add), so a copy with
 * merged vertices is still found; ShapeFix_Face only reorients, which IsSame ignores.
 */
function edgeRolesOf(
  edges: readonly TopoDS_Shape[],
  idEdges: readonly IdEdge[],
): ReadonlyMap<number, string> {
  const roles = new Map<number, string>();
  for (const { edge, id } of idEdges) {
    const index = indexOfSame(edges, edge);
    if (index >= 0) roles.set(index, id);
  }
  return roles;
}

/** The roles edge:<id> → the edge indices with that id, ascending; undefined when none. */
function edgeRoleKeys(
  edgeRoles: ReadonlyMap<number, string>,
): Readonly<Record<string, readonly SubShapeIndex[]>> | undefined {
  if (edgeRoles.size === 0) return undefined;
  const roles: Record<string, SubShapeIndex[]> = {};
  const sorted = [...edgeRoles].sort(([a], [b]) => a - b);
  for (const [index, id] of sorted) {
    (roles[`edge:${id}`] ??= []).push({ type: 'edge', index });
  }
  return roles;
}

/**
 * New TopoDS_Shape of the face; the caller owns it. gp_Pln with the frame of the plane, edges
 * built in space, wires by BRepBuilderAPI_MakeWire, the face by BRepBuilderAPI_MakeFace with
 * the holes added, then ShapeFix_Face.FixOrientation (orients the holes). A wire that does not
 * close or a face BRepCheck_Analyzer finds invalid (a self-intersecting loop) is
 * 'operation-failed'.
 */
export function faceShape(oc: Occt, input: FaceInput, idEdges?: IdEdge[]): TopoDS_Shape {
  const { plane } = input;
  using origin = point(oc, plane, [0, 0]);
  using normal = new oc.gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]);
  using xDir = new oc.gp_Dir(plane.xDir[0], plane.xDir[1], plane.xDir[2]);
  using frame = new oc.gp_Ax3(origin, normal, xDir);
  using pln = new oc.gp_Pln(frame);

  using outer = wire(oc, plane, input.outer, idEdges);
  using maker = new oc.BRepBuilderAPI_MakeFace(pln, outer, true);
  for (const loop of input.holes) {
    using hole = wire(oc, plane, loop, idEdges);
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

/**
 * New wire of the loop; the caller owns it. For a curve with an id, the edge as it is in the
 * wire (MakeWire.Edge(), possibly a copy with merged vertices) goes to `idEdges`.
 */
function wire(oc: Occt, plane: Plane, loop: ProfileLoop, idEdges?: IdEdge[]): TopoDS_Wire {
  using maker = new oc.BRepBuilderAPI_MakeWire();
  for (const c of loop) {
    using e = edge(oc, plane, c);
    maker.Add(e);
    if (idEdges !== undefined && c.id !== undefined && maker.IsDone()) {
      idEdges.push({ edge: maker.Edge(), id: c.id });
    }
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
    case 'bspline': {
      using curve = bsplineOf(oc, plane, c);
      using maker = new oc.BRepBuilderAPI_MakeEdge(curve);
      return done(maker).Edge();
    }
  }
}

/**
 * New non-rational Geom_BSplineCurve in space (M29): the poles mapped into the plane, the knot
 * vector compressed to distinct knots with their multiplicities (the OCCT form). The arrays
 * have lower bound 0; the constructor copies them.
 */
function bsplineOf(oc: Occt, plane: Plane, c: Extract<ProfileCurve, { kind: 'bspline' }>) {
  const { knots, multiplicities } = compressKnots(c.knots);
  using poles = new oc.NCollection_Array1_gp_Pnt(c.poles.length);
  c.poles.forEach((v, i) => {
    using p = point(oc, plane, v);
    poles.SetValue(i, p);
  });
  using knotArray = new oc.NCollection_Array1_double(knots.length);
  using multArray = new oc.NCollection_Array1_int(knots.length);
  knots.forEach((k, i) => {
    knotArray.SetValue(i, k);
    multArray.SetValue(i, multiplicities[i] ?? 0);
  });
  return new oc.Geom_BSplineCurve(poles, knotArray, multArray, c.degree, false);
}

/**
 * The distinct knots of a non-decreasing knot vector and how often each repeats; also the 2D
 * splines of the regions (regions.ts).
 */
export function compressKnots(flat: readonly number[]): {
  knots: number[];
  multiplicities: number[];
} {
  const knots: number[] = [];
  const multiplicities: number[] = [];
  for (const k of flat) {
    const last = knots.length - 1;
    if (last >= 0 && knots[last] === k) multiplicities[last] = (multiplicities[last] ?? 0) + 1;
    else {
      knots.push(k);
      multiplicities.push(1);
    }
  }
  return { knots, multiplicities };
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
