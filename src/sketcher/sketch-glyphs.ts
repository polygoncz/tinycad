// The glyphs of the constraints of the edited sketch for the viewport (spec 12, "Glyfy vazeb
// (M25)"; Q083): a small mark of the kind of a geometric constraint next to each of its entities,
// in world coordinates. ui projects the anchors and lays the glyphs out in pixels.

import { assertNever, bspline, plane as planeMath, vec3 } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import type {
  DimensionKind,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
} from '@/sketch';
import { constraintTargets } from '@/sketch';
import { ccwSweep } from './sketch-angles';

/** The geometric constraints; the dimensions have their own drawing (sketch-dimensions). */
export type GlyphKind = Exclude<SketchConstraint['kind'], DimensionKind>;

export interface SketchGlyphView {
  readonly constraint: SketchConstraintId;
  readonly kind: GlyphKind;
  /** The entity the glyph lies at; a constraint of two entities has two glyphs (one at each). */
  readonly entity: SketchEntityId;
  /** The anchor on the entity in world coordinates. */
  readonly anchor: Vec3;
  /** Unit direction in the plane of the sketch (in the world) the glyphs at one anchor stack along; away from the entity. */
  readonly side: Vec3;
  /** Order in the row at the same anchor (0, 1, …) in the order of the constraints in the data. */
  readonly slot: number;
  /** The constraint is under the cursor (hover of a glyph) or selected. */
  readonly hover: boolean;
  readonly selected: boolean;
}

/** A geometric constraint: one that has glyphs. */
export type GlyphConstraint = Extract<SketchConstraint, { readonly kind: GlyphKind }>;

/** Anchors closer than this in plane coordinates (mm) share one row of glyphs. */
const SAME_ANCHOR = 1e-6;

/** Below this |n_y| / |n| the normal of a line counts as horizontal: the line is vertical (→ −x). */
const VERTICAL_TOLERANCE = 1e-9;

/** The parameter of the anchor of a spline: the middle of its range (spec 12 "Spliny (M29)"). */
const SPLINE_ANCHOR_T = 0.5;

/** The side of a point glyph: +x+y of the plane, normalised. */
const POINT_SIDE: Vec2 = [Math.SQRT1_2, Math.SQRT1_2];

/**
 * The views of the glyphs of the geometric constraints in their order, for each constraint its
 * entities in the order of the constraint. `visible = 'all'` → every geometric constraint;
 * otherwise those referring to an entity of the set. A glyph whose entity is missing is left out.
 * An unchanged item stays the same object from `prev`, an unchanged result the same array.
 */
export function glyphViews(
  plane: Plane,
  data: SketchData,
  visible: 'all' | ReadonlySet<SketchItemId>,
  selection: readonly SketchItemId[],
  hover: SketchItemId | null,
  prev: readonly SketchGlyphView[],
): readonly SketchGlyphView[] {
  const byId = new Map<string, SketchEntity>(data.entities.map((e) => [e.id, e]));
  const old = new Map<string, SketchGlyphView>(prev.map((g) => [keyOf(g), g]));
  const rows: Row[] = [];
  const views: SketchGlyphView[] = [];
  for (const c of data.constraints) {
    if (!isGlyphConstraint(c)) continue;
    if (visible !== 'all' && !constraintTargets(c).some((id) => visible.has(id))) continue;
    for (const entityId of glyphEntities(c)) {
      const entity = byId.get(entityId);
      const at = entity === undefined ? null : anchorOf(byId, entity);
      if (at === null) continue;
      const slot = nextSlot(rows, at.point);
      const view: SketchGlyphView = {
        constraint: c.id,
        kind: c.kind,
        entity: entityId,
        anchor: planeMath.toWorld(plane, at.point),
        side: worldDirection(plane, at.side),
        slot,
        hover: hover === c.id,
        selected: selection.includes(c.id),
      };
      const before = old.get(keyOf(view));
      views.push(before !== undefined && sameView(before, view) ? before : Object.freeze(view));
    }
  }
  const unchanged = views.length === prev.length && views.every((v, i) => v === prev[i]);
  return unchanged ? prev : Object.freeze(views);
}

/** true for a geometric constraint; written out per kind, so a new kind fails the typecheck. */
export function isGlyphConstraint(c: SketchConstraint): c is GlyphConstraint {
  switch (c.kind) {
    case 'coincident':
    case 'horizontal':
    case 'vertical':
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'tangent':
    case 'fix':
    case 'pointOnCurve':
    case 'midpoint':
    case 'hAlign':
    case 'vAlign':
    case 'symmetric':
      return true;
    case 'distance':
    case 'hDistance':
    case 'vDistance':
    case 'pointLineDistance':
    case 'angle':
    case 'radius':
    case 'diameter':
      return false;
    default:
      return assertNever(c);
  }
}

/**
 * The entities that get a glyph: all of them, except coincident (one dot at point a) and
 * pointOnCurve and midpoint (one glyph at the point).
 */
function glyphEntities(c: GlyphConstraint): readonly SketchEntityId[] {
  switch (c.kind) {
    case 'coincident':
      return [c.a];
    case 'pointOnCurve':
    case 'midpoint':
      return [c.point];
    default:
      return constraintTargets(c);
  }
}

/** A row of glyphs at one position: its first anchor and the next free slot. */
interface Row {
  readonly at: Vec2;
  next: number;
}

/** The slot of a glyph at `at`: the next one of the row at that position, or 0 of a new row. */
function nextSlot(rows: Row[], at: Vec2): number {
  const row = rows.find((r) => Math.hypot(r.at[0] - at[0], r.at[1] - at[1]) <= SAME_ANCHOR);
  if (row === undefined) {
    rows.push({ at, next: 1 });
    return 0;
  }
  return row.next++;
}

interface Anchor {
  readonly point: Vec2;
  /** Unit direction in the plane. */
  readonly side: Vec2;
}

/**
 * The anchor of the glyphs of an entity in plane coordinates: a point = the point (side +x+y); a
 * line = its middle (side its normal turned to +y, a vertical line −x); a circle = its top (side
 * +y); an arc = the middle of the arc (side from the centre outwards); a spline = its point at
 * t = 0.5 (side the normal of its tangent there turned to +y, like a line). null when a point of
 * the entity is missing.
 */
function anchorOf(byId: ReadonlyMap<string, SketchEntity>, entity: SketchEntity): Anchor | null {
  switch (entity.kind) {
    case 'point':
      return { point: [entity.x, entity.y], side: POINT_SIDE };
    case 'line': {
      const p1 = pointOf(byId, entity.p1);
      const p2 = pointOf(byId, entity.p2);
      if (p1 === null || p2 === null) return null;
      const middle: Vec2 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      return { point: middle, side: lineSide(p1, p2) };
    }
    case 'circle': {
      const center = pointOf(byId, entity.center);
      if (center === null) return null;
      return { point: [center[0], center[1] + entity.radius], side: [0, 1] };
    }
    case 'arc': {
      const center = pointOf(byId, entity.center);
      const start = pointOf(byId, entity.start);
      const end = pointOf(byId, entity.end);
      if (center === null || start === null || end === null) return null;
      const from = angleOf(center, start);
      const middle = from + ccwSweep(from, angleOf(center, end)) / 2;
      const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
      // The side from the angle, not from the anchor: defined also for a zero radius.
      const side: Vec2 = [Math.cos(middle), Math.sin(middle)];
      return { point: [center[0] + radius * side[0], center[1] + radius * side[1]], side };
    }
    case 'bspline':
    case 'fitSpline': {
      const poles =
        entity.kind === 'bspline' ? entity.poles.map((id) => pointOf(byId, id)) : entity.poles;
      if (!poles.every((p): p is Vec2 => p !== null)) return null;
      const shape = { degree: entity.degree, poles, knots: entity.knots };
      const point = bspline.evaluate(shape, SPLINE_ANCHOR_T);
      const d = bspline.derivative(shape, SPLINE_ANCHOR_T);
      // The side of the tangent as a line through the anchor; a zero derivative → +y.
      return { point, side: lineSide(point, [point[0] + d[0], point[1] + d[1]]) };
    }
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
    case 'text':
      // No constraint refers to a pattern or a text (parseSketchData), so it never carries a glyph.
      return null;
    default:
      return assertNever(entity);
  }
}

/**
 * The unit normal of the line p1 → p2 turned to +y of the plane; a vertical line (|n_y| within
 * the tolerance) → −x, so solver noise does not flip it; a line of zero length → +y.
 */
function lineSide(p1: Vec2, p2: Vec2): Vec2 {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return [0, 1];
  const n: Vec2 = [-dy / length, dx / length];
  if (Math.abs(n[1]) <= VERTICAL_TOLERANCE) return [-1, 0];
  return n[1] > 0 ? n : [-n[0], -n[1]];
}

/** A direction in plane coordinates as a world vector. */
function worldDirection(plane: Plane, d: Vec2): Vec3 {
  return vec3.add(vec3.scale(plane.xDir, d[0]), vec3.scale(planeMath.yDir(plane), d[1]));
}

function pointOf(byId: ReadonlyMap<string, SketchEntity>, id: string): Vec2 | null {
  const entity = byId.get(id);
  return entity?.kind === 'point' ? [entity.x, entity.y] : null;
}

const angleOf = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);

/** A glyph is one constraint at one entity. */
const keyOf = (g: Pick<SketchGlyphView, 'constraint' | 'entity'>): string =>
  `${g.constraint}\u0000${g.entity}`;

function sameView(a: SketchGlyphView, b: SketchGlyphView): boolean {
  return (
    a.constraint === b.constraint &&
    a.kind === b.kind &&
    a.entity === b.entity &&
    sameVec(a.anchor, b.anchor) &&
    sameVec(a.side, b.side) &&
    a.slot === b.slot &&
    a.hover === b.hover &&
    a.selected === b.selected
  );
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.every((v, i) => Object.is(v, b[i]));
