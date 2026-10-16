// Shared parts of the shape tools of M31 (spec 12, "Nové kreslicí nástroje (M31)"): the
// computed points of a shape go through the snapper without the grid and never onto the clicked
// points, an alignment of a point with another point of the shape is dropped, a first side or a
// construction line gets its axis from inferLine, and the shape is written in one addDrawn (construction mode, M31) with
// the required constraints of its draft.

import type { Vec2 } from '@/core';
import { inferLine } from '@/sketch';
import type {
  LineInference,
  PointInference,
  ShapeDraft,
  ShapeIds,
  SketchConstraint,
  SketchData,
  SketchEntityId,
} from '@/sketch';
import type { ToolContext } from '@/interaction';
import type { SketchSession } from '../sketch-session';
import { ANGLE_TOLERANCE, addDrawn, newConstraintId, newEntityId } from './common';
import { freeTarget, snapPoint } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

/** An axis a first side or a construction line gets (spec 12, M31, B3). */
export type AxisKind = 'horizontal' | 'vertical';

/** New ids for the topology of a shape from the generator of the tool context. */
export function shapeIds(ctx: ToolContext): ShapeIds {
  return { entity: () => newEntityId(ctx), constraint: () => newConstraintId(ctx) };
}

/** A snap target for each point of a tuple of points. */
export type TargetsOf<T extends readonly unknown[]> = { readonly [K in keyof T]: SnapTarget };

/**
 * The snap targets of computed points of a shape: snapped without the grid and never onto the
 * `clicked` targets; a computed point onto the same existing point as an earlier one is a new
 * point there (two corners of a shape on one point would collapse a side).
 */
export function snapComputed<T extends readonly Vec2[]>(
  data: SketchData,
  points: T,
  tolerance: number,
  infer: boolean,
  clicked: readonly SnapTarget[],
): TargetsOf<T> {
  const exclude = new Set(clicked.flatMap((t) => (t.point === null ? [] : [t.point])));
  const mode = { infer, grid: null, exclude };
  const taken = new Set<SketchEntityId>();
  const targets = points.map((at) => {
    const target = snapPoint(data, at, tolerance, mode);
    if (target.point === null) return target;
    if (taken.has(target.point)) return freeTarget(at);
    taken.add(target.point);
    return target;
  });
  // map keeps the length of the tuple, which its type does not say.
  return targets as unknown as TargetsOf<T>;
}

/**
 * The targets without their alignments with the existing points among them: such an alignment
 * duplicates a side or an axis of the shape.
 */
export function withoutOwnAlignment<T extends readonly SnapTarget[]>(targets: T): TargetsOf<T> {
  const own = new Set(targets.flatMap((t) => (t.point === null ? [] : [t.point])));
  const filtered = targets.map((t) => ({
    ...t,
    inferred: t.inferred.filter((i) => !alignedWith(i, own)),
  }));
  // map keeps the length of the tuple, which its type does not say.
  return filtered as unknown as TargetsOf<T>;
}

function alignedWith(i: PointInference, points: ReadonlySet<SketchEntityId>): boolean {
  return (i.kind === 'hAlign' || i.kind === 'vAlign') && points.has(i.with);
}

/**
 * The second point of a first side or a construction line from `from` to `target`: the target
 * without its alignment with `from`, and the axis of the side (B3: only horizontal or vertical,
 * automatic). An alignment with `from` becomes the axis, otherwise inferLine within 3° decides.
 * Without inference (Ctrl/Cmd) no axis.
 */
export function sideAxis(
  data: SketchData,
  from: SnapTarget,
  target: SnapTarget,
  infer: boolean,
): { readonly target: SnapTarget; readonly axis: AxisKind | null } {
  const align =
    from.point === null
      ? undefined
      : target.inferred.find(
          (i) => (i.kind === 'hAlign' || i.kind === 'vAlign') && i.with === from.point,
        );
  const inferred = target.inferred.filter((i) => i !== align);
  const to = { ...target, inferred };
  if (!infer) return { target: to, axis: null };
  if (align !== undefined) {
    return { target: to, axis: align.kind === 'hAlign' ? 'horizontal' : 'vertical' };
  }
  const axis = inferLine({ at: from.at, point: from.point }, target.at, data, {
    previous: null,
    angleTolerance: ANGLE_TOLERANCE,
  }).find((i): i is Extract<LineInference, { kind: AxisKind }> => isAxis(i.kind));
  return { target: to, axis: axis?.kind ?? null };
}

const isAxis = (kind: string): kind is AxisKind => kind === 'horizontal' || kind === 'vertical';

/** The axis constraint of the line `line` (automatic), or none. */
export function axisConstraint(
  ctx: ToolContext,
  axis: AxisKind | null,
  line: SketchEntityId | undefined,
): readonly SketchConstraint[] {
  if (axis === null || line === undefined) return [];
  return [{ kind: axis, id: newConstraintId(ctx), line }];
}

/**
 * Writes a shape: the new points with their inferred constraints, the curves and constraints of
 * the draft (its `required` required) and the `automatic` constraints, in one addDrawn (construction mode, M31).
 */
export function addShape(
  session: SketchSession,
  points: readonly PlacedPoint[],
  draft: ShapeDraft,
  automatic: readonly SketchConstraint[] = [],
): void {
  void addDrawn(
    session,
    {
      entities: [...points.flatMap((p) => p.entities), ...draft.curves],
      constraints: [...points.flatMap((p) => p.constraints), ...draft.constraints, ...automatic],
    },
    { required: new Set(draft.required) },
  );
}
