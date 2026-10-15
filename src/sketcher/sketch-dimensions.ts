// The dimensions of the edited sketch for the viewport (spec 10, "SketchState"; M19.2 D4): where
// a dimension is drawn, in world coordinates. ui projects the points and lays out the lines.

import { plane as planeMath } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchEntity,
  SketchItemId,
  SketchPoint,
} from '@/sketch';
import { ccwSweep } from './sketch-angles';

export interface SketchDimensionView {
  readonly id: SketchConstraintId;
  readonly kind: 'distance' | 'radius';
  /** The exact value of the constraint; ui rounds it. */
  readonly value: number;
  /** distance: point a; radius: the centre of the curve. In world coordinates. */
  readonly from: Vec3;
  /** distance: point b; radius: a point on the curve (a circle at π/4, an arc halfway). */
  readonly to: Vec3;
  /** Order within its kind like SketchConstraintRow.n ("Distance 1"). */
  readonly n: number;
  readonly selected: boolean;
}

/**
 * The number of each constraint within its kind, from 1 in the order of `constraints` ("Distance
 * 2" is the second distance). The one numbering of the panel rows (SketchConstraintRow.n) and of
 * the dimensions in the view (SketchDimensionView.n), so a label and its row always agree.
 */
export function constraintNumbers(constraints: readonly SketchConstraint[]): readonly number[] {
  const counts = new Map<SketchConstraint['kind'], number>();
  return constraints.map((c) => {
    const n = (counts.get(c.kind) ?? 0) + 1;
    counts.set(c.kind, n);
    return n;
  });
}

/**
 * The views of the distance and radius constraints in their order. A dimension whose entity is
 * missing (or a radius on something else than a circle or an arc) is left out. An unchanged item
 * stays the same object from `prev`, an unchanged result the same array.
 */
export function dimensionViews(
  plane: Plane,
  entities: readonly SketchEntity[],
  constraints: readonly SketchConstraint[],
  selection: readonly SketchItemId[],
  prev: readonly SketchDimensionView[],
): readonly SketchDimensionView[] {
  const byId = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));
  const old = new Map<string, SketchDimensionView>(prev.map((d) => [d.id, d]));
  // Numbered like the panel rows: every constraint of the kind counts, even a skipped one.
  const numbers = constraintNumbers(constraints);
  const views: SketchDimensionView[] = [];
  for (const [i, c] of constraints.entries()) {
    const n = numbers[i] ?? 0;
    if (c.kind !== 'distance' && c.kind !== 'radius') continue;
    const ends = c.kind === 'distance' ? distanceEnds(byId, c.a, c.b) : radiusEnds(byId, c.curve);
    if (ends === null) continue;
    const view: SketchDimensionView = {
      id: c.id,
      kind: c.kind,
      value: c.value,
      from: planeMath.toWorld(plane, ends[0]),
      to: planeMath.toWorld(plane, ends[1]),
      n,
      selected: selection.includes(c.id),
    };
    const before = old.get(c.id);
    views.push(before !== undefined && sameView(before, view) ? before : Object.freeze(view));
  }
  const unchanged = views.length === prev.length && views.every((v, i) => v === prev[i]);
  return unchanged ? prev : Object.freeze(views);
}

type Ends = readonly [Vec2, Vec2];

function distanceEnds(byId: ReadonlyMap<string, SketchEntity>, a: string, b: string): Ends | null {
  const pa = pointOf(byId, a);
  const pb = pointOf(byId, b);
  return pa === null || pb === null ? null : [pa, pb];
}

/** The centre and the point on the curve: a circle at π/4, an arc halfway along its sweep. */
function radiusEnds(byId: ReadonlyMap<string, SketchEntity>, curve: string): Ends | null {
  const entity = byId.get(curve);
  if (entity?.kind === 'circle') {
    const center = pointOf(byId, entity.center);
    return center === null ? null : [center, onCircle(center, entity.radius, Math.PI / 4)];
  }
  if (entity?.kind === 'arc') {
    const center = pointOf(byId, entity.center);
    const start = pointOf(byId, entity.start);
    const end = pointOf(byId, entity.end);
    if (center === null || start === null || end === null) return null;
    const from = angleOf(center, start);
    const middle = from + ccwSweep(from, angleOf(center, end)) / 2;
    const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
    return [center, onCircle(center, radius, middle)];
  }
  return null;
}

function pointOf(byId: ReadonlyMap<string, SketchEntity>, id: string): Vec2 | null {
  const entity = byId.get(id);
  return entity?.kind === 'point' ? xy(entity) : null;
}

const xy = (p: SketchPoint): Vec2 => [p.x, p.y];

const angleOf = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);

const onCircle = (center: Vec2, radius: number, angle: number): Vec2 => [
  center[0] + radius * Math.cos(angle),
  center[1] + radius * Math.sin(angle),
];

function sameView(a: SketchDimensionView, b: SketchDimensionView): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    Object.is(a.value, b.value) &&
    sameVec(a.from, b.from) &&
    sameVec(a.to, b.to) &&
    a.n === b.n &&
    a.selected === b.selected
  );
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.every((v, i) => Object.is(v, b[i]));
