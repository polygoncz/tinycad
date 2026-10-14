import type { TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import { createKernelError, type Axis, type ShapeResult, type SubShapeIndex } from '@/kernel';
import { collectHistory, outputFaces, type HistoryMaker } from './history';
import { hasSolid, type Occt } from './occt';
import { indexOfSame, type AddShape, type ShapeEntry } from './shape-entry';

// Sweeping a planar face (spec 06, "Tažení v adaptéru (M13)"): a prism and a solid of
// revolution, with roles and history (M14). Internal to kernel-occt; the inputs are already
// checked by OcctKernelImpl.

/** Throws 'invalid-input' unless `shape` is a face (TopAbs_FACE). */
export function requireFace(oc: Occt, shape: TopoDS_Shape, op: string): void {
  if (shape.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_FACE) {
    throw createKernelError('invalid-input', `${op}: the profile is not a face`);
  }
}

/**
 * The prism of the face `profile` along the vector `shift` (d̂ · distance), stored through
 * `add`. BRepPrimAPI_MakePrism without a copy, with canonized surfaces.
 */
export function prismResult(
  oc: Occt,
  profile: ShapeEntry,
  shift: Vec3,
  add: AddShape,
): ShapeResult {
  using vector = new oc.gp_Vec(shift[0], shift[1], shift[2]);
  using maker = new oc.BRepPrimAPI_MakePrism(profile.shape, vector, false, true);
  return add(checkedSolid(oc, maker, 'extrude'), sweepDescription(oc, maker, profile));
}

/**
 * The face `profile` revolved about `axis` by `angle` radians (0 < angle ≤ 2π), stored through
 * `add`. BRepPrimAPI_MakeRevol without a copy.
 */
export function revolResult(
  oc: Occt,
  profile: ShapeEntry,
  axis: Axis,
  angle: number,
  add: AddShape,
): ShapeResult {
  using origin = new oc.gp_Pnt(axis.origin[0], axis.origin[1], axis.origin[2]);
  using direction = new oc.gp_Dir(axis.direction[0], axis.direction[1], axis.direction[2]);
  using ax1 = new oc.gp_Ax1(origin, direction);
  using maker = new oc.BRepPrimAPI_MakeRevol(profile.shape, ax1, angle, false);
  return add(checkedSolid(oc, maker, 'revolve'), sweepDescription(oc, maker, profile));
}

interface SweepMaker extends HistoryMaker {
  FirstShape(): TopoDS_Shape;
  LastShape(): TopoDS_Shape;
}

/**
 * Roles and history of a sweep (spec 06, M14): face:start and face:end from FirstShape and
 * LastShape, only when they are in the result (a full revolution has neither); face:side:<id>
 * from Generated of each profile edge with a role; the history with the profile as input 0.
 */
function sweepDescription(oc: Occt, maker: SweepMaker, profile: ShapeEntry) {
  return {
    describe: (entry: ShapeEntry) => {
      const roles: Record<string, readonly SubShapeIndex[]> = {};
      for (const [role, end] of [
        ['face:start', () => maker.FirstShape()],
        ['face:end', () => maker.LastShape()],
      ] as const) {
        using shape = end();
        const index = indexOfSame(entry.faces, shape);
        if (index >= 0) roles[role] = [{ type: 'face', index }];
      }
      // Faces swept from each profile edge by Generated; an edge whose Generated is empty gets
      // the fallback by its vertices, among the faces nobody else claims (sweptByVertices).
      const generated = profile.edges.map((edge) => {
        using list = maker.Generated(edge);
        return outputFaces(oc, list, entry).map((f) => f.index);
      });
      const claimed = new Set([
        ...Object.values(roles).flatMap((subs) => subs.map((s) => s.index)),
        ...generated.flat(),
      ]);
      const sides = new Map<string, Set<number>>();
      for (const [edgeIndex, id] of profile.edgeRoles) {
        const edge = profile.edges[edgeIndex];
        if (edge === undefined) continue;
        let swept = generated[edgeIndex] ?? [];
        if (swept.length === 0) swept = sweptByVertices(oc, maker, entry, edge, claimed);
        const faces = sides.get(id) ?? new Set<number>();
        for (const f of swept) faces.add(f);
        sides.set(id, faces);
      }
      for (const [id, faces] of sides) {
        if (faces.size === 0) continue;
        const sorted = [...faces].sort((a, b) => a - b);
        roles[`face:side:${id}`] = sorted.map((index) => ({ type: 'face', index }));
      }
      const history = collectHistory(oc, maker, [profile], entry);
      return Object.keys(roles).length > 0 ? { roles, history } : { history };
    },
  };
}

/**
 * Fallback of Generated for a side face: the unclaimed output faces bounded by every edge
 * swept from a vertex of the profile edge. BRepPrimAPI_MakeRevol returns an empty Generated
 * for an edge perpendicular to the axis in a full revolution, and the result has no seam on
 * the planar annulus swept from it (checked in M14), so the annulus is found by its circles.
 */
function sweptByVertices(
  oc: Occt,
  maker: HistoryMaker,
  entry: ShapeEntry,
  edge: TopoDS_Shape,
  claimed: ReadonlySet<number>,
): number[] {
  const { TopAbs_VERTEX, TopAbs_EDGE, TopAbs_SHAPE } = oc.TopAbs_ShapeEnum;
  const rings = new Set<number>();
  using vertices = new oc.TopExp_Explorer(edge, TopAbs_VERTEX, TopAbs_SHAPE);
  while (vertices.More()) {
    using vertex = vertices.Current();
    using list = maker.Generated(vertex);
    while (!list.IsEmpty()) {
      using item = list.First();
      list.RemoveFirst();
      const index = item.ShapeType() === TopAbs_EDGE ? indexOfSame(entry.edges, item) : -1;
      if (index >= 0) rings.add(index);
    }
    vertices.Next();
  }
  if (rings.size === 0) return [];
  const found: number[] = [];
  entry.faces.forEach((face, index) => {
    if (claimed.has(index)) return;
    const bounding = new Set<number>();
    using edges = new oc.TopExp_Explorer(face, TopAbs_EDGE, TopAbs_SHAPE);
    while (edges.More()) {
      using current = edges.Current();
      bounding.add(indexOfSame(entry.edges, current));
      edges.Next();
    }
    if ([...rings].every((r) => bounding.has(r))) found.push(index);
  });
  return found;
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
