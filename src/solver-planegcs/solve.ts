// One solve of a sketch with planegcs (spec 12 "Řešič vazeb", Adaptér; ADR 0016). Internal to
// solver-planegcs: hides the snake_case API and the mutable sketch_index behind a pure function.

import { DebugMode, GcsWrapper, SolveStatus, type SketchPrimitive } from '@salusoft89/planegcs';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchEntity,
  SketchEntityId,
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
  const dof = w.gcs.dof();

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
  }
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
  }
}

type Curve = Exclude<SketchEntity, { readonly kind: 'point' }>;

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
  }
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
