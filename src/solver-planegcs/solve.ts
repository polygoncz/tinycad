// One solve of a sketch with planegcs (spec 12 "Řešič vazeb", Adaptér; ADR 0016). Internal to
// solver-planegcs: hides the snake_case API and the mutable sketch_index behind a pure function.

import { DebugMode, GcsWrapper, SolveStatus, type SketchPrimitive } from '@salusoft89/planegcs';
import type { Vec2 } from '@/core';
import type {
  SketchBSpline,
  SketchConstraint,
  SketchConstraintId,
  SketchEntity,
  SketchEntityId,
  SketchFitSpline,
  SketchLine,
  SolveInput,
  SolveResult,
} from '@/sketch';
import type { PlanegcsModule } from './planegcs-module';
import { isWasmTrap } from './wasm-trap';

/** The result of a solve that did not work out: no positions, no degrees of freedom. */
export const FAILED: SolveResult = Object.freeze({
  status: 'failed',
  entities: null,
  dof: null,
  conflicting: Object.freeze([]),
  redundant: Object.freeze([]),
});

/** Prefix of the temporary drag constraints; never reported back. */
const DRAG = '__drag';

/**
 * Solves the sketch synchronously. Every call builds a new GcsSystem (the wrapper cannot remove
 * a constraint) and destroys it at the end. A WebAssembly.RuntimeError passes through – the
 * module instance is dead and its owner must discard it; any other exception is status 'failed'.
 */
export function solveSketch(mod: PlanegcsModule, input: SolveInput): SolveResult {
  let wrapper: GcsWrapper | undefined;
  try {
    wrapper = new GcsWrapper(new mod.GcsSystem(), mod);
    return solveWith(wrapper, input);
  } catch (e) {
    if (isWasmTrap(e)) {
      // The memory of the module may be corrupted: do not touch it again, not even to destroy.
      wrapper = undefined;
      throw e;
    }
    return FAILED;
  } finally {
    wrapper?.destroy_gcs_module();
  }
}

function solveWith(w: GcsWrapper, input: SolveInput): SolveResult {
  // Before pushing: in debug mode planegcs prints to stdout (ADR 0016, pitfall 2).
  w.debug_mode = DebugMode.NoDebug;
  const { primitives, constraintIds } = toPrimitives(input);
  if (primitives === undefined) return FAILED;
  w.push_primitives_and_params(primitives);

  const status = w.solve();
  const conflicting = backToIds(w.get_gcs_conflicting_constraints(), constraintIds);
  const redundant = backToIds(w.get_gcs_redundant_constraints(), constraintIds);
  // Temporary drag constraints do not count, so this is the dof without the drag.
  const dof = w.gcs.dof() - unusedSplineParams(primitives);

  if (conflicting.length > 0) {
    return { status: 'conflict', entities: null, dof, conflicting, redundant };
  }
  if (status !== SolveStatus.Success && status !== SolveStatus.Converged) return FAILED;

  w.apply_solution();
  const entities = readEntities(w, input.entities);
  if (entities === undefined) return FAILED;
  return { status: 'ok', entities, dof, conflicting, redundant };
}

interface Primitives {
  /** undefined: the input cannot be solved (the dragged point does not exist). */
  readonly primitives: SketchPrimitive[] | undefined;
  /** planegcs id → id of the sketch constraint it comes from. */
  readonly constraintIds: ReadonlyMap<string, SketchConstraintId>;
}

function toPrimitives(input: SolveInput): Primitives {
  const kinds = new Map<SketchEntityId, SketchEntity>(input.entities.map((e) => [e.id, e]));
  const constraintIds = new Map<string, SketchConstraintId>();
  const primitives: SketchPrimitive[] = input.entities.flatMap((e) => entityPrimitives(e, kinds));

  // After all entities: the fit points may come after their spline.
  for (const e of input.entities) {
    if (e.kind !== 'fitSpline') continue;
    for (const p of fitPrimitives(e)) {
      constraintIds.set(p.id, splineAsConstraintId(e.id));
      primitives.push(p);
    }
  }

  for (const c of input.constraints) {
    for (const p of constraintPrimitives(c, kinds)) {
      constraintIds.set(p.id, c.id);
      primitives.push(p);
    }
  }

  const { drag } = input;
  if (drag !== undefined) {
    if (kinds.get(drag.point)?.kind !== 'point') return { primitives: undefined, constraintIds };
    const [x, y] = drag.to;
    primitives.push(
      { id: `${DRAG}:x`, type: 'coordinate_x', p_id: drag.point, x, temporary: true },
      { id: `${DRAG}:y`, type: 'coordinate_y', p_id: drag.point, y, temporary: true },
    );
  }
  return { primitives, constraintIds };
}

function entityPrimitives(
  e: SketchEntity,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive[] {
  switch (e.kind) {
    case 'point':
      // Never fixed: a constraint between two fixed points would be ignored silently (ADR 0016).
      return [{ id: e.id, type: 'point', x: e.x, y: e.y, fixed: false }];
    case 'line':
      return [{ id: e.id, type: 'line', p1_id: e.p1, p2_id: e.p2 }];
    case 'circle':
      return [{ id: e.id, type: 'circle', c_id: e.center, radius: e.radius }];
    case 'arc': {
      const center = pointOf(entities, e.center);
      const start = pointOf(entities, e.start);
      const end = pointOf(entities, e.end);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      // Counter-clockwise from start to end.
      if (endAngle <= startAngle) endAngle += 2 * Math.PI;
      return [
        {
          id: e.id,
          type: 'arc',
          c_id: e.center,
          start_id: e.start,
          end_id: e.end,
          start_angle: startAngle,
          end_angle: endAngle,
          radius: Math.hypot(start.x - center.x, start.y - center.y),
        },
        // Ties the end points to the angles and the radius; not a sketch constraint.
        { id: `${e.id}:rules`, type: 'arc_rules', a_id: e.id },
      ];
    }
    case 'bspline':
      // Not in planegcs (Q087): its control points are sketch points and no planegcs constraint
      // refers to the curve itself, so the primitive would not change the solution.
      return [];
    case 'fitSpline': {
      // The control points are hidden planegcs points, started from the poles in the data.
      const poles = e.poles.map(([x, y], i): SketchPrimitive => ({
        id: poleId(e, i),
        type: 'point',
        x,
        y,
        fixed: false,
      }));
      const knots = [...new Set(e.knots)];
      return [
        ...poles,
        {
          id: e.id,
          type: 'bspline',
          pole_ids: poles.map((p) => p.id),
          weights: poles.map(() => 1),
          knots,
          mult: knots.map((k) => e.knots.filter((x) => x === k).length),
          degree: e.degree,
          periodic: false,
        },
      ];
    }
  }
}

/** The hidden control point `i` of a fitSpline in planegcs. */
function poleId(spline: SketchFitSpline, i: number): string {
  return `${spline.id}:pole${String(i)}`;
}

/** Every fit point on the curve at its fixed parameter (a number: no degree of freedom). */
function fitPrimitives(spline: SketchFitSpline): SketchPrimitive[] {
  return spline.params.map((t, i) => {
    const p = spline.fit[i];
    if (p === undefined) throw new Error(`${spline.id} has no fit point ${String(i)}`);
    return {
      id: `${spline.id}:fit${String(i)}`,
      type: 'point_on_bspline',
      p_id: p,
      b_id: spline.id,
      pointparam: t,
    };
  });
}

/**
 * A fitSpline reports its fit point constraints under its own id (spec 12, Spliny): the user
 * sees the spline, the hidden equations have no constraint of their own.
 */
function splineAsConstraintId(id: SketchEntityId): SketchConstraintId {
  // Both brands are strings; the spec wants the entity id in conflicting/redundant, whose type
  // only knows constraint ids, hence the cast through string.
  return id as string as SketchConstraintId;
}

/**
 * The degrees of freedom planegcs counts but the sketch does not have (Q087). For every bspline
 * a constraint refers to, the wrapper creates 4 free parameters for the start and end of the
 * curve – copies of the end control points, not shared variables – and no equation uses them.
 * A test guards that planegcs still does so.
 */
function unusedSplineParams(primitives: readonly SketchPrimitive[]): number {
  const referenced = new Set<string>();
  for (const p of primitives) {
    if (p.type === 'point_on_bspline' || p.type === 'tangent_at_bspline_knot') {
      referenced.add(p.b_id);
    }
  }
  return 4 * referenced.size;
}

function constraintPrimitives(
  c: SketchConstraint,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive[] {
  switch (c.kind) {
    case 'coincident':
      return [{ id: c.id, type: 'p2p_coincident', p1_id: c.a, p2_id: c.b }];
    case 'horizontal':
      return [{ id: c.id, type: 'horizontal_l', l_id: c.line }];
    case 'vertical':
      return [{ id: c.id, type: 'vertical_l', l_id: c.line }];
    case 'parallel':
      return [{ id: c.id, type: 'parallel', l1_id: c.a, l2_id: c.b }];
    case 'perpendicular':
      return [{ id: c.id, type: 'perpendicular_ll', l1_id: c.a, l2_id: c.b }];
    case 'equal':
      return [equalPrimitive(c.id, curveOf(entities, c.a), curveOf(entities, c.b))];
    case 'tangent':
      return [tangentPrimitive(c.id, curveOf(entities, c.a), curveOf(entities, c.b))];
    case 'pointOnCurve':
      return [pointOnCurvePrimitive(c.id, c.point, curveOf(entities, c.curve))];
    case 'midpoint': {
      // p1 and p2 symmetric about the point: the point is the middle of the line.
      const line = curveOf(entities, c.line);
      if (line.kind !== 'line') throw new Error(`midpoint of a ${line.kind}`);
      return [
        { id: c.id, type: 'p2p_symmetric_ppp', p1_id: line.p1, p2_id: line.p2, p_id: c.point },
      ];
    }
    case 'hAlign':
      return [{ id: c.id, type: 'horizontal_pp', p1_id: c.a, p2_id: c.b }];
    case 'vAlign':
      return [{ id: c.id, type: 'vertical_pp', p1_id: c.a, p2_id: c.b }];
    case 'fix': {
      // Two equations on the current coordinates instead of `fixed: true` (ADR 0016).
      const p = pointOf(entities, c.point);
      return [
        { id: `${c.id}:x`, type: 'coordinate_x', p_id: c.point, x: p.x },
        { id: `${c.id}:y`, type: 'coordinate_y', p_id: c.point, y: p.y },
      ];
    }
    case 'distance':
      return [{ id: c.id, type: 'p2p_distance', p1_id: c.a, p2_id: c.b, distance: c.value }];
    case 'radius': {
      const curve = curveOf(entities, c.curve);
      if (curve.kind === 'circle') {
        return [{ id: c.id, type: 'circle_radius', c_id: curve.id, radius: c.value }];
      }
      if (curve.kind === 'arc') {
        return [{ id: c.id, type: 'arc_radius', a_id: curve.id, radius: c.value }];
      }
      throw new Error(`radius of a ${curve.kind}`);
    }
    case 'hDistance':
    case 'vDistance':
      return [axisDistancePrimitive(c.id, c.kind === 'hDistance' ? 'x' : 'y', c, entities)];
    case 'pointLineDistance':
      return [{ id: c.id, type: 'p2l_distance', p_id: c.point, l_id: c.line, distance: c.value }];
    case 'angle':
      return [anglePrimitive(c, entities)];
    case 'diameter': {
      const curve = curveOf(entities, c.curve);
      if (curve.kind === 'circle') {
        return [{ id: c.id, type: 'circle_diameter', c_id: curve.id, diameter: c.value }];
      }
      if (curve.kind === 'arc') {
        return [{ id: c.id, type: 'arc_diameter', a_id: curve.id, diameter: c.value }];
      }
      throw new Error(`diameter of a ${curve.kind}`);
    }
  }
}

type Curve = Exclude<SketchEntity, { readonly kind: 'point' }>;

/**
 * hDistance/vDistance: the model value is unsigned, planegcs `difference` is signed
 * (param2 − param1 = difference). The order follows the current position, so the solve keeps
 * the points on their sides: b right of / above a (or level with it) → b − a, else a − b.
 */
function axisDistancePrimitive(
  id: string,
  axis: 'x' | 'y',
  c: { readonly a: SketchEntityId; readonly b: SketchEntityId; readonly value: number },
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive {
  const [from, to] =
    pointOf(entities, c.b)[axis] >= pointOf(entities, c.a)[axis] ? [c.a, c.b] : [c.b, c.a];
  return {
    id,
    type: 'difference',
    param1: { o_id: from, prop: axis },
    param2: { o_id: to, prop: axis },
    difference: c.value,
  };
}

/**
 * angle: the model value is unsigned in (0, π) between the directions p1→p2 (reversed by the
 * flags); planegcs l2l_angle_pppp is the oriented angle from the first line to the second. The
 * lines go in the order in which the current angle is counter-clockwise (positive), so the
 * solve keeps the angle in the chosen quadrant instead of flipping it over.
 */
function anglePrimitive(
  c: Extract<SketchConstraint, { readonly kind: 'angle' }>,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive {
  const [a1, a2] = orientedEnds(entities, c.a, c.reverseA === true);
  const [b1, b2] = orientedEnds(entities, c.b, c.reverseB === true);
  const da = direction(entities, a1, a2);
  const db = direction(entities, b1, b2);
  const counterClockwise = da.x * db.y - da.y * db.x >= 0;
  const [l1p1, l1p2, l2p1, l2p2] = counterClockwise ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
  return {
    id: c.id,
    type: 'l2l_angle_pppp',
    l1p1_id: l1p1,
    l1p2_id: l1p2,
    l2p1_id: l2p1,
    l2p2_id: l2p2,
    angle: c.value,
  };
}

/** The end points of a line, swapped when its direction is reversed. */
function orientedEnds(
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  id: SketchEntityId,
  reverse: boolean,
): readonly [SketchEntityId, SketchEntityId] {
  const line = curveOf(entities, id);
  if (line.kind !== 'line') throw new Error(`${id} is not a line`);
  return reverse ? [line.p2, line.p1] : [line.p1, line.p2];
}

function direction(
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  from: SketchEntityId,
  to: SketchEntityId,
): { readonly x: number; readonly y: number } {
  const p = pointOf(entities, from);
  const q = pointOf(entities, to);
  return { x: q.x - p.x, y: q.y - p.y };
}

function equalPrimitive(id: string, a: Curve, b: Curve): SketchPrimitive {
  if (a.kind === 'line' && b.kind === 'line') {
    return { id, type: 'equal_length', l1_id: a.id, l2_id: b.id };
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
  }
  if (a.kind === 'circle' && b.kind === 'arc') {
    return { id, type: 'equal_radius_ca', c1_id: a.id, a2_id: b.id };
  }
  if (a.kind === 'arc' && b.kind === 'circle') {
    return { id, type: 'equal_radius_ca', c1_id: b.id, a2_id: a.id };
  }
  throw new Error(`equal between a ${a.kind} and a ${b.kind}`);
}

function tangentPrimitive(id: string, a: Curve, b: Curve): SketchPrimitive {
  // The line always first.
  const [first, second] = b.kind === 'line' ? [b, a] : [a, b];
  if (first.kind === 'line' && (second.kind === 'bspline' || second.kind === 'fitSpline')) {
    return { id, type: 'point_on_line_pl', p_id: nextToEnd(first, second), l_id: first.id };
  }
  if (first.kind === 'line' && second.kind === 'circle') {
    return { id, type: 'tangent_lc', l_id: first.id, c_id: second.id };
  }
  if (first.kind === 'line' && second.kind === 'arc') {
    return { id, type: 'tangent_la', l_id: first.id, a_id: second.id };
  }
  if (first.kind === 'circle' && second.kind === 'circle') {
    return { id, type: 'tangent_cc', c1_id: first.id, c2_id: second.id };
  }
  if (first.kind === 'arc' && second.kind === 'arc') {
    return { id, type: 'tangent_aa', a1_id: first.id, a2_id: second.id };
  }
  if (first.kind === 'circle' && second.kind === 'arc') {
    return { id, type: 'tangent_ca', c_id: first.id, a_id: second.id };
  }
  if (first.kind === 'arc' && second.kind === 'circle') {
    return { id, type: 'tangent_ca', c_id: second.id, a_id: first.id };
  }
  throw new Error(`tangent between a ${a.kind} and a ${b.kind}`);
}

/** On the whole carrier line of a line, on the whole circle of a circle or an arc (spec 12). */
function pointOnCurvePrimitive(id: string, point: SketchEntityId, curve: Curve): SketchPrimitive {
  switch (curve.kind) {
    case 'line':
      return { id, type: 'point_on_line_pl', p_id: point, l_id: curve.id };
    case 'circle':
      return { id, type: 'point_on_circle', p_id: point, c_id: curve.id };
    case 'arc':
      return { id, type: 'point_on_arc', p_id: point, a_id: curve.id };
    default:
      throw new Error(`point on a ${curve.kind}`);
  }
}

/**
 * The control point next to the end the line shares (Q087): a clamped spline starts in P0 with
 * its tangent along P1 − P0, so the line through P0 is tangent when P1 lies on it (at the last
 * end the second-to-last control point). tangent_at_bspline_knot fails at an end knot.
 */
function nextToEnd(line: SketchLine, spline: SketchBSpline | SketchFitSpline): string {
  const ends = spline.kind === 'bspline' ? spline.poles : spline.fit;
  const n = ends.length;
  const shares = (p: SketchEntityId | undefined) => p === line.p1 || p === line.p2;
  const i = shares(ends[0]) ? 1 : shares(ends[n - 1]) ? n - 2 : undefined;
  if (i === undefined) throw new Error(`${line.id} does not share an end of ${spline.id}`);
  if (spline.kind === 'fitSpline') return poleId(spline, i);
  const pole = spline.poles[i];
  if (pole === undefined) throw new Error(`${spline.id} has no control point ${String(i)}`);
  return pole;
}

function pointOf(
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  id: SketchEntityId,
): { readonly x: number; readonly y: number } {
  const e = entities.get(id);
  if (e?.kind !== 'point') throw new Error(`${id} is not a point`);
  return e;
}

function curveOf(entities: ReadonlyMap<SketchEntityId, SketchEntity>, id: SketchEntityId): Curve {
  const e = entities.get(id);
  if (e === undefined || e.kind === 'point') throw new Error(`${id} is not a curve`);
  return e;
}

/** planegcs ids → sketch constraint ids: suffixes off, drag and arc rules out, no duplicates. */
function backToIds(
  ids: readonly string[],
  constraintIds: ReadonlyMap<string, SketchConstraintId>,
): SketchConstraintId[] {
  const out = new Set<SketchConstraintId>();
  for (const id of ids) {
    const c = constraintIds.get(id);
    if (c !== undefined) out.add(c);
  }
  return [...out];
}

/** The input entities with the solved coordinates and radii; undefined if any is not finite. */
function readEntities(w: GcsWrapper, input: readonly SketchEntity[]): SketchEntity[] | undefined {
  const out: SketchEntity[] = [];
  for (const e of input) {
    if (e.kind === 'point') {
      const { x, y } = w.sketch_index.get_sketch_point(e.id);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      out.push({ ...e, x, y });
    } else if (e.kind === 'fitSpline') {
      const poles = e.poles.map((_, i): Vec2 => {
        const { x, y } = w.sketch_index.get_sketch_point(poleId(e, i));
        return [x, y];
      });
      if (!poles.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return undefined;
      out.push({ ...e, poles });
    } else if (e.kind === 'circle') {
      const { radius } = w.sketch_index.get_sketch_circle(e.id);
      if (!Number.isFinite(radius)) return undefined;
      out.push({ ...e, radius });
    } else {
      out.push(e);
    }
  }
  return out;
}
