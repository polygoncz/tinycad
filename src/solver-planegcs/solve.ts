// One solve of a sketch with planegcs (spec 12 "Řešič vazeb", Adaptér; ADR 0016). Internal to
// solver-planegcs: hides the snake_case API and the mutable sketch_index behind a pure function.

import { DebugMode, GcsWrapper, SolveStatus, type SketchPrimitive } from '@salusoft89/planegcs';
import { bspline, type BSplineShape, type Vec2 } from '@/core';
import { isCurveEntity } from '@/sketch';
import type {
  SketchArc,
  SketchBSpline,
  SketchConstraint,
  SketchConstraintId,
  SketchCurve,
  SketchEntity,
  SketchEntityId,
  SketchFitSpline,
  SketchLine,
  SketchXLine,
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
 * Solves the sketch synchronously. Every solve builds a new GcsSystem (the wrapper cannot remove
 * a constraint) and destroys it at the end. A WebAssembly.RuntimeError passes through – the
 * module instance is dead and its owner must discard it; any other exception is status 'failed'.
 *
 * A point on a spline has a free curve parameter, which planegcs cannot keep in [0, 1]. When it
 * leaves the range, the sketch is solved once more with every such parameter fixed at the end
 * it passed (spec 12, Spliny, Bod na splinu): the point sticks to the end of the curve. The dof
 * is the one of the first solve; a conflict or failure of the second one is the result.
 */
export function solveSketch(mod: PlanegcsModule, input: SolveInput): SolveResult {
  try {
    const first = solveOnce(mod, input, new Map());
    if (first.ends.size === 0) return first.result;
    const second = solveOnce(mod, input, first.ends).result;
    return second.status === 'failed' ? second : { ...second, dof: first.result.dof };
  } catch (e) {
    if (isWasmTrap(e)) throw e;
    return FAILED;
  }
}

/** pointOnCurve on a spline → the end its parameter is fixed at (second solve only). */
type Ends = ReadonlyMap<SketchConstraintId, 0 | 1>;

interface Solved {
  readonly result: SolveResult;
  /** The points on a spline whose parameter left [0, 1], with the end it passed. */
  readonly ends: Ends;
}

function solveOnce(mod: PlanegcsModule, input: SolveInput, ends: Ends): Solved {
  let wrapper: GcsWrapper | undefined;
  try {
    wrapper = new GcsWrapper(new mod.GcsSystem(), mod);
    return solveWith(wrapper, input, ends);
  } catch (e) {
    // The memory of the module may be corrupted: do not touch it again, not even to destroy.
    if (isWasmTrap(e)) wrapper = undefined;
    throw e;
  } finally {
    wrapper?.destroy_gcs_module();
  }
}

const NO_ENDS: Ends = new Map();

function solveWith(w: GcsWrapper, input: SolveInput, ends: Ends): Solved {
  const failed = { result: FAILED, ends: NO_ENDS };
  // Before pushing: in debug mode planegcs prints to stdout (ADR 0016, pitfall 2).
  w.debug_mode = DebugMode.NoDebug;
  const { primitives, params, constraintIds } = toPrimitives(input, ends);
  if (primitives === undefined) return failed;
  // Unfixed, so the parameter is a variable; before the constraints that refer to it.
  for (const p of params) w.push_sketch_param(p.name, p.value, false);
  w.push_primitives_and_params(primitives);

  const status = w.solve();
  const rawConflicting = w.get_gcs_conflicting_constraints();
  const conflicting = backToIds(rawConflicting, constraintIds);
  const redundant = backToIds(w.get_gcs_redundant_constraints(), constraintIds);
  // Temporary drag constraints do not count, so this is the dof without the drag.
  const dof = w.gcs.dof() - unusedSplineParams(primitives);

  // From the raw list: a conflict among internal constraints only is a conflict too (spec 12,
  // Spliny), just with an empty list.
  if (rawConflicting.length > 0) {
    return { result: { status: 'conflict', entities: null, dof, conflicting, redundant }, ends };
  }
  if (status !== SolveStatus.Success && status !== SolveStatus.Converged) return failed;

  w.apply_solution();
  const entities = readEntities(w, input.entities);
  if (entities === undefined) return failed;
  return {
    result: { status: 'ok', entities, dof, conflicting, redundant },
    ends: passedEnds(w, params),
  };
}

/** The free parameters that left [0, 1] in the solution, with the end they passed. */
function passedEnds(w: GcsWrapper, params: readonly FreeParam[]): Ends {
  const out = new Map<SketchConstraintId, 0 | 1>();
  for (const p of params) {
    const t = w.get_sketch_param_value(p.name);
    if (t === undefined) continue;
    if (t < 0) out.set(p.constraint, 0);
    else if (t > 1) out.set(p.constraint, 1);
  }
  return out;
}

/** The free curve parameter of a point on a spline: a planegcs sketch param. */
interface FreeParam {
  readonly name: string;
  /** The start value. */
  readonly value: number;
  readonly constraint: SketchConstraintId;
}

interface Primitives {
  /** undefined: the input cannot be solved (the dragged point does not exist). */
  readonly primitives: SketchPrimitive[] | undefined;
  /** Free parameters the primitives refer to by name. */
  readonly params: readonly FreeParam[];
  /** planegcs id → id of the sketch constraint it comes from; internal constraints are absent. */
  readonly constraintIds: ReadonlyMap<string, SketchConstraintId>;
}

function toPrimitives(input: SolveInput, ends: Ends): Primitives {
  const entities = input.entities.map(asLine);
  const kinds = new Map<SketchEntityId, SolverEntity>(entities.map((e) => [e.id, e]));
  const constraintIds = new Map<string, SketchConstraintId>();
  const params: FreeParam[] = [];
  const primitives: SketchPrimitive[] = entities.flatMap((e) => entityPrimitives(e, kinds));

  // A bspline only when a point lies on it (Q087): nothing else in planegcs refers to the curve.
  const onBSpline = new Set<SketchEntityId>();
  for (const c of input.constraints) {
    if (c.kind === 'pointOnCurve' && kinds.get(c.curve)?.kind === 'bspline') onBSpline.add(c.curve);
  }

  // After all entities: the control and fit points may come after their spline. The fit point
  // constraints are internal, not reported back (spec 12, Spliny).
  for (const e of entities) {
    if (e.kind === 'fitSpline') primitives.push(...fitPrimitives(e));
    if (e.kind === 'bspline' && onBSpline.has(e.id)) {
      primitives.push(bsplinePrimitive(e.id, e.poles, e.knots, e.degree));
    }
  }

  for (const c of input.constraints) {
    const spline = c.kind === 'pointOnCurve' ? splineOf(kinds, c.curve) : undefined;
    if (c.kind === 'pointOnCurve' && spline !== undefined) {
      const { primitive, param } = pointOnSpline(c, spline, kinds, ends.get(c.id));
      if (param !== undefined) params.push(param);
      constraintIds.set(primitive.id, c.id);
      primitives.push(primitive);
      continue;
    }
    for (const p of constraintPrimitives(c, kinds)) {
      constraintIds.set(p.id, c.id);
      primitives.push(p);
    }
  }

  const { drag } = input;
  if (drag !== undefined) {
    if (kinds.get(drag.point)?.kind !== 'point') {
      return { primitives: undefined, params, constraintIds };
    }
    const [x, y] = drag.to;
    primitives.push(
      { id: `${DRAG}:x`, type: 'coordinate_x', p_id: drag.point, x, temporary: true },
      { id: `${DRAG}:y`, type: 'coordinate_y', p_id: drag.point, y, temporary: true },
    );
  }
  return { primitives, params, constraintIds };
}

/** An entity as planegcs sees it: an xline is a line (M31). */
type SolverEntity = Exclude<SketchEntity, SketchXLine>;

/**
 * An xline as a line through p1 and p2 (M31): planegcs constraints on a line already work with
 * its infinite carrier line, and the constraints a line has but an xline must not (equal,
 * midpoint, tangent to a spline) never reach the solver (parseSketchData). Only for building the
 * primitives; the result keeps the input entities.
 */
function asLine(e: SketchEntity): SolverEntity {
  return e.kind === 'xline'
    ? { kind: 'line', id: e.id, p1: e.p1, p2: e.p2, construction: true }
    : e;
}

function entityPrimitives(
  e: SolverEntity,
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
      // Only its control points (Q087), which are sketch points; the curve itself goes into
      // planegcs only when a point lies on it (toPrimitives).
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
      return [
        ...poles,
        bsplinePrimitive(
          e.id,
          poles.map((p) => p.id),
          e.knots,
          e.degree,
        ),
      ];
    }
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
    case 'text':
      // Recipes (M36, M37): their copies and letters are derived from the solved originals,
      // never solved.
      return [];
  }
}

/** A planegcs bspline (no weights, clamped): planegcs wants distinct knots with multiplicities. */
function bsplinePrimitive(
  id: string,
  poleIds: readonly string[],
  knots: readonly number[],
  degree: number,
): SketchPrimitive {
  const distinct = [...new Set(knots)];
  return {
    id,
    type: 'bspline',
    pole_ids: [...poleIds],
    weights: poleIds.map(() => 1),
    knots: distinct,
    mult: distinct.map((k) => knots.filter((x) => x === k).length),
    degree,
    periodic: false,
  };
}

type Spline = SketchBSpline | SketchFitSpline;

function splineOf(
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  id: SketchEntityId,
): Spline | undefined {
  const e = entities.get(id);
  return e?.kind === 'bspline' || e?.kind === 'fitSpline' ? e : undefined;
}

/**
 * pointOnCurve on a spline: point_on_bspline with a free parameter `<id>:t`, started from the
 * parameter of the curve point nearest to the point (spec 12, Bod na splinu). With an end, the
 * parameter is that number instead – fixed, no degree of freedom.
 */
function pointOnSpline(
  c: Extract<SketchConstraint, { readonly kind: 'pointOnCurve' }>,
  spline: Spline,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  end: 0 | 1 | undefined,
): { readonly primitive: SketchPrimitive; readonly param: FreeParam | undefined } {
  const primitive = (pointparam: number | string): SketchPrimitive => ({
    id: c.id,
    type: 'point_on_bspline',
    p_id: c.point,
    b_id: spline.id,
    pointparam,
  });
  if (end !== undefined) return { primitive: primitive(end), param: undefined };
  const name = `${c.id}:t`;
  const { x, y } = pointOf(entities, c.point);
  const value = nearestParam(shapeOf(spline, entities), [x, y]);
  return { primitive: primitive(name), param: { name, value, constraint: c.id } };
}

/** The curve of a spline as it enters the solve: sketch points or the poles in the data. */
function shapeOf(
  spline: Spline,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): BSplineShape {
  const poles =
    spline.kind === 'fitSpline'
      ? spline.poles
      : spline.poles.map((id): Vec2 => {
          const { x, y } = pointOf(entities, id);
          return [x, y];
        });
  return { degree: spline.degree, poles, knots: spline.knots };
}

/** Samples per knot span when looking for the nearest curve point. */
const SAMPLES_PER_SPAN = 16;
/** Newton steps refining the nearest sample. */
const NEWTON_STEPS = 8;

/**
 * The parameter in [0, 1] of the curve point nearest to p: the nearest of samples in every knot
 * span, refined by Newton on (C(t) − p) · C'(t) = 0. Only a start value for planegcs.
 */
function nearestParam(curve: BSplineShape, p: Vec2): number {
  const distance2 = (t: number): number => {
    const [x, y] = bspline.evaluate(curve, t);
    return (x - p[0]) ** 2 + (y - p[1]) ** 2;
  };
  const knots = [...new Set(curve.knots)];
  let best = 0;
  let bestDistance = distance2(0);
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1] ?? 0;
    const b = knots[i] ?? 1;
    for (let k = 1; k <= SAMPLES_PER_SPAN; k++) {
      const t = a + ((b - a) * k) / SAMPLES_PER_SPAN;
      const d = distance2(t);
      if (d < bestDistance) [best, bestDistance] = [t, d];
    }
  }
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const [x, y] = bspline.evaluate(curve, best);
    const [dx, dy] = bspline.derivative(curve, best, 1);
    const [ddx, ddy] = bspline.derivative(curve, best, 2);
    const [rx, ry] = [x - p[0], y - p[1]];
    const slope = dx * dx + dy * dy + rx * ddx + ry * ddy;
    if (!(slope > 0)) break;
    best = Math.min(1, Math.max(0, best - (rx * dx + ry * dy) / slope));
  }
  return best;
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
      return [tangentPrimitive(c.id, curveOf(entities, c.a), curveOf(entities, c.b), entities)];
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
    case 'symmetric':
      return [{ id: c.id, type: 'p2p_symmetric_ppl', p1_id: c.a, p2_id: c.b, l_id: c.axis }];
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
    case 'offset':
      return c.pairs.flatMap((pair, i) =>
        offsetPrimitives(`${c.id}:${String(i)}`, pair, c, entities),
      );
  }
}

type Curve = SketchCurve;

/** Relative tolerance of "the copy line is tangent to the copy arc in their shared point". */
const TANGENT_TOLERANCE = 1e-6;

type Offset = Extract<SketchConstraint, { readonly kind: 'offset' }>;

/**
 * One pair of an offset (M35, spec 12 "Vazba offset"), ids `<pair id>:a|b`.
 *
 * Lines: every end point of the copy at the distance from the source carrier line (unsigned: the
 * side holds from the position for small steps only – a large change of the original may flip it
 * over, like pointLineDistance; parallelism follows). An end point shared with the copy of an
 * arc of the same offset, where the copy line is tangent to that arc now, gets a tangent in the
 * point instead: there the distance would make a double root (the offset line touches the
 * offset circle), a rank-deficient system with a redundancy and a slow convergence. A line
 * tangent at both ends is then defined by the concentric arcs r ± d alone.
 *
 * Arcs and circles share the centre (the data), so only the radii: a signed difference whose
 * order follows the current position like axisDistancePrimitive – the copy outside (or equal) →
 * copy − source, inside → source − copy. Known limit: two copy arcs tangent in a shared point
 * stay degenerate (a point on two tangent circles).
 */
function offsetPrimitives(
  id: string,
  pair: Offset['pairs'][number],
  c: Offset,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive[] {
  const source = curveOf(entities, pair.source);
  const copy = curveOf(entities, pair.copy);
  if (source.kind === 'line' && copy.kind === 'line') {
    return (
      [
        [`${id}:a`, copy.p1],
        [`${id}:b`, copy.p2],
      ] as const
    ).map(([pid, end]): SketchPrimitive => {
      const arc = tangentCopyArc(c, copy, end, entities);
      return arc === undefined
        ? { id: pid, type: 'p2l_distance', p_id: end, l_id: source.id, distance: c.value }
        : tangentAtEndPrimitive(pid, copy, arc, end, entities);
    });
  }
  const rs = radiusOf(source, entities);
  const rc = radiusOf(copy, entities);
  const [from, to] = rc >= rs ? [source.id, copy.id] : [copy.id, source.id];
  return [
    {
      id: `${id}:a`,
      type: 'difference',
      param1: { o_id: from, prop: 'radius' },
      param2: { o_id: to, prop: 'radius' },
      difference: c.value,
    },
  ];
}

/**
 * The copy arc of the same offset that ends in `end` of the copy line and to which the line is
 * tangent there now (its direction perpendicular to the radius); undefined if none.
 */
function tangentCopyArc(
  c: Offset,
  line: SketchLine,
  end: SketchEntityId,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchArc | undefined {
  const along = direction(entities, line.p1, line.p2);
  for (const { copy } of c.pairs) {
    const arc = curveOf(entities, copy);
    if (arc.kind !== 'arc' || (arc.start !== end && arc.end !== end)) continue;
    const radius = direction(entities, arc.center, end);
    const dot = along.x * radius.x + along.y * radius.y;
    const scale = Math.hypot(along.x, along.y) * Math.hypot(radius.x, radius.y);
    if (Math.abs(dot) <= TANGENT_TOLERANCE * scale) return arc;
  }
  return undefined;
}

/** The current radius of a circle or an arc (an arc: from its start point). */
function radiusOf(c: Curve, entities: ReadonlyMap<SketchEntityId, SketchEntity>): number {
  if (c.kind === 'circle') return c.radius;
  if (c.kind !== 'arc') throw new Error(`offset of a ${c.kind}`);
  const d = direction(entities, c.center, c.start);
  return Math.hypot(d.x, d.y);
}

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

function tangentPrimitive(
  id: string,
  a: Curve,
  b: Curve,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive {
  const shared = sharedEnd(a, b);
  if (shared !== undefined) return tangentAtEndPrimitive(id, a, b, shared, entities);
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

/**
 * The end point a line or an arc shares with another line or arc (spec 12, "Tečnost ve sdíleném
 * koncovém bodě"); undefined for any other pair. Splines and circles keep their own mapping.
 */
function sharedEnd(a: Curve, b: Curve): SketchEntityId | undefined {
  const endsA = endsOf(a);
  const endsB = endsOf(b);
  if (endsA === undefined || endsB === undefined) return undefined;
  if (a.kind === 'line' && b.kind === 'line') return undefined;
  return endsA.find((p) => endsB.includes(p));
}

function endsOf(c: Curve): readonly SketchEntityId[] | undefined {
  if (c.kind === 'line') return [c.p1, c.p2];
  if (c.kind === 'arc') return [c.start, c.end];
  return undefined;
}

/**
 * Tangency in a shared end point as FreeCAD does it: the angle between the curves in the point
 * is 0 or π, whichever is nearer to the current one. tangent_la / tangent_aa are degenerate
 * there (the distance of the centre from the other curve is at its maximum, the gradient is
 * dependent) and planegcs would report them redundant. Decided anew on every solve; the
 * geometry moves continuously between solves.
 */
function tangentAtEndPrimitive(
  id: string,
  a: Curve,
  b: Curve,
  at: SketchEntityId,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): SketchPrimitive {
  const ta = tangentAt(a, at, entities);
  const tb = tangentAt(b, at, entities);
  const sameSense = ta.x * tb.x + ta.y * tb.y >= 0;
  return {
    id,
    type: 'angle_via_point',
    crv1_id: a.id,
    crv2_id: b.id,
    p_id: at,
    angle: sameSense ? 0 : Math.PI,
  };
}

/**
 * The tangent direction of a line (p1 → p2) or an arc (counter-clockwise) in its end point, in
 * the sense planegcs measures the angle via a point (its normals are these turned by 90°).
 */
function tangentAt(
  c: Curve,
  at: SketchEntityId,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
): { readonly x: number; readonly y: number } {
  if (c.kind === 'line') return direction(entities, c.p1, c.p2);
  if (c.kind !== 'arc') throw new Error(`tangent in an end point of a ${c.kind}`);
  const r = direction(entities, c.center, at);
  return { x: -r.y, y: r.x };
}

/**
 * On the whole carrier line of a line, on the whole circle of a circle or an arc (spec 12). On a
 * spline see pointOnSpline.
 */
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
  if (e === undefined || !isCurveEntity(e)) throw new Error(`${id} is not a curve`);
  return e;
}

/**
 * planegcs ids → sketch constraint ids: suffixes off, drag, arc rules and fit points out, no
 * duplicates.
 */
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
