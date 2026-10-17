// The dimensions of the parameters of a selected pattern for the viewport (spec 12, "Zrcadlení a
// pole (M36)", "Vynesené kóty pole"): the count, the spacing and the angle of a linear pattern per
// direction, the count and the total angle of a circular one, a mirror none. Each is a label in
// world coordinates with an optional guide line; ui projects them and edits the value
// (SketchSession.setPatternParam).

import { plane as planeMath, vec2 } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import { circularStep, curvePoints, isPatternSource, patternParamsValid } from '@/sketch';
import type {
  PatternDirection,
  SketchCircularPattern,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SketchLinearPattern,
  SketchPattern,
} from '@/sketch';

const { add, mid, scale, sub } = vec2;

/** A parameter of a pattern: per direction of a linear pattern, or of a circular one. */
export type PatternParam =
  'count1' | 'spacing1' | 'angle1' | 'count2' | 'spacing2' | 'angle2' | 'count' | 'angle';

export interface SketchPatternDimensionView {
  readonly pattern: SketchEntityId;
  readonly param: PatternParam;
  /** ui: "n×", "… mm", "…°". */
  readonly format: 'count' | 'length' | 'angle';
  /** An angle in radians; count2 without the second direction = 1. */
  readonly value: number;
  /** The centre of the label in the world. */
  readonly label: Vec3;
  /** The polyline of the dimension (spacing: a segment, angle: a sampled arc); may be empty. */
  readonly guide: readonly Vec3[];
}

/** Points of a sampled arc, like the angular dimension (sketch-dimensions.ts). */
const ARC_POINTS = 33;
/** Below this a length is degenerate, like in sketch (spec 12). */
const MIN = 1e-9;
/** The radius of the angle of a circular pattern whose anchor lies in its centre (spec 12). */
const FALLBACK_RADIUS = 10;

/**
 * The direction and its field of a parameter of a linear pattern; count2 is not here (it adds or
 * removes the second direction, withLinearParam).
 */
const DIRECTION_FIELDS: Partial<
  Record<PatternParam, readonly [direction: 1 | 2, field: keyof PatternDirection]>
> = Object.freeze({
  count1: [1, 'count'],
  spacing1: [1, 'spacing'],
  angle1: [1, 'angle'],
  spacing2: [2, 'spacing'],
  angle2: [2, 'angle'],
});

const NO_GUIDE: readonly Vec3[] = Object.freeze([]);

/** The bounding box of the defining points of the sources (a circle ± its radius); null for none. */
export function sourceBox(
  entities: readonly SketchEntity[],
  sources: readonly SketchEntityId[],
): { readonly min: Vec2; readonly max: Vec2 } | null {
  const byId = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));
  const at = (id: string): Vec2 | null => {
    const p = byId.get(id);
    return p?.kind === 'point' ? [p.x, p.y] : null;
  };
  const corners: Vec2[] = [];
  for (const id of sources) {
    const source = byId.get(id);
    if (source === undefined || !isPatternSource(source)) continue;
    if (source.kind === 'point') {
      corners.push([source.x, source.y]);
      continue;
    }
    const points = curvePoints(source).flatMap((p) => {
      const xy = at(p);
      return xy === null ? [] : [xy];
    });
    if (source.kind === 'circle') {
      const r = source.radius;
      corners.push(
        ...points.flatMap(([x, y]): Vec2[] => [
          [x - r, y - r],
          [x + r, y + r],
        ]),
      );
    } else {
      corners.push(...points);
    }
  }
  if (corners.length === 0) return null;
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/**
 * The views of the selected patterns in selection order; a pattern without an anchor (no source
 * point) or a circular one without its centre is left out. An unchanged item stays the same
 * object from `prev`, an unchanged result the same array.
 */
export function patternDimensionViews(
  plane: Plane,
  entities: readonly SketchEntity[],
  selection: readonly SketchItemId[],
  prev: readonly SketchPatternDimensionView[],
): readonly SketchPatternDimensionView[] {
  const byId = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));
  const old = new Map<string, SketchPatternDimensionView>(prev.map((v) => [keyOf(v), v]));
  const views: SketchPatternDimensionView[] = [];
  for (const id of selection) {
    const entity = byId.get(id);
    if (entity === undefined) continue;
    const planar =
      entity.kind === 'linearPattern'
        ? linearViews(entity, entities)
        : entity.kind === 'circularPattern'
          ? circularViews(entity, entities, byId)
          : [];
    for (const v of planar) {
      const view: SketchPatternDimensionView = {
        pattern: entity.id,
        param: v.param,
        format: v.format,
        value: v.value,
        label: planeMath.toWorld(plane, v.label),
        guide: v.guide.length === 0 ? NO_GUIDE : v.guide.map((p) => planeMath.toWorld(plane, p)),
      };
      const before = old.get(keyOf(view));
      views.push(before !== undefined && sameView(before, view) ? before : freezeView(view));
    }
  }
  const unchanged = views.length === prev.length && views.every((v, i) => v === prev[i]);
  return unchanged ? prev : Object.freeze(views);
}

/** A view in plane coordinates. */
interface PlanarView {
  readonly param: PatternParam;
  readonly format: SketchPatternDimensionView['format'];
  readonly value: number;
  readonly label: Vec2;
  readonly guide: readonly Vec2[];
}

/** The anchor of a pattern: the middle of the box of its sources. */
function anchorOf(
  entities: readonly SketchEntity[],
  sources: readonly SketchEntityId[],
): Vec2 | null {
  const box = sourceBox(entities, sources);
  return box === null ? null : mid(box.min, box.max);
}

function linearViews(
  pattern: SketchLinearPattern,
  entities: readonly SketchEntity[],
): readonly PlanarView[] {
  const a = anchorOf(entities, pattern.sources);
  if (a === null) return [];
  const d1 = pattern.direction1;
  const d2 = pattern.direction2;
  const first = directionViews(a, d1, ['count1', 'spacing1', 'angle1']);
  if (d2 !== undefined)
    return [...first, ...directionViews(a, d2, ['count2', 'spacing2', 'angle2'])];
  // Without the second direction only its count, 1×, across direction 1 at spacing 1.
  const u1 = unit(d1.angle);
  const across: Vec2 = [-u1[1], u1[0]];
  return [
    ...first,
    {
      param: 'count2',
      format: 'count',
      value: 1,
      label: add(a, scale(across, d1.spacing)),
      guide: [],
    },
  ];
}

/** Count at the last instance, spacing from the anchor to the first, angle from the x axis. */
function directionViews(
  a: Vec2,
  d: PatternDirection,
  [count, spacing, angle]: readonly [PatternParam, PatternParam, PatternParam],
): readonly PlanarView[] {
  const u = unit(d.angle);
  const first = add(a, scale(u, d.spacing));
  // The shorter way from the x axis to the direction, whatever turns the stored angle makes.
  const sweep = Math.atan2(u[1], u[0]);
  return [
    {
      param: count,
      format: 'count',
      value: d.count,
      label: add(a, scale(u, (d.count - 1) * d.spacing)),
      guide: [],
    },
    { param: spacing, format: 'length', value: d.spacing, label: mid(a, first), guide: [a, first] },
    {
      param: angle,
      format: 'angle',
      value: d.angle,
      label: onArc(a, d.spacing / 2, 0, sweep / 2),
      guide: arc(a, d.spacing / 2, 0, sweep),
    },
  ];
}

function circularViews(
  pattern: SketchCircularPattern,
  entities: readonly SketchEntity[],
  byId: ReadonlyMap<string, SketchEntity>,
): readonly PlanarView[] {
  const a = anchorOf(entities, pattern.sources);
  const center = byId.get(pattern.center);
  if (a === null || center?.kind !== 'point') return [];
  const c: Vec2 = [center.x, center.y];
  const ca = sub(a, c);
  const degenerate = Math.hypot(ca[0], ca[1]) <= MIN;
  const r = degenerate ? FALLBACK_RADIUS : Math.hypot(ca[0], ca[1]);
  const from = degenerate ? 0 : Math.atan2(ca[1], ca[0]);
  const { count, angle } = pattern;
  const step = circularStep(pattern);
  return [
    {
      param: 'count',
      format: 'count',
      value: count,
      label: onArc(c, r, from, (count - 1) * step),
      guide: [],
    },
    {
      param: 'angle',
      format: 'angle',
      value: angle,
      label: onArc(c, r, from, angle / 2),
      guide: arc(c, r, from, angle),
    },
  ];
}

/** The point of the circle around `center` at the angle from + by. */
function onArc(center: Vec2, radius: number, from: number, by: number): Vec2 {
  return add(center, scale(unit(from + by), radius));
}

/** The arc from the angle `from` by `sweep` (signed), sampled in 33 points. */
function arc(center: Vec2, radius: number, from: number, sweep: number): readonly Vec2[] {
  return Array.from({ length: ARC_POINTS }, (_, i) =>
    onArc(center, radius, from, (sweep * i) / (ARC_POINTS - 1)),
  );
}

const unit = (angle: number): Vec2 => [Math.cos(angle), Math.sin(angle)];

const keyOf = (v: SketchPatternDimensionView): string => `${v.pattern}/${v.param}`;

function freezeView(v: SketchPatternDimensionView): SketchPatternDimensionView {
  return Object.freeze({
    ...v,
    guide: v.guide === NO_GUIDE ? NO_GUIDE : Object.freeze(v.guide),
  });
}

function sameView(a: SketchPatternDimensionView, b: SketchPatternDimensionView): boolean {
  return (
    a.pattern === b.pattern &&
    a.param === b.param &&
    a.format === b.format &&
    Object.is(a.value, b.value) &&
    sameVec(a.label, b.label) &&
    a.guide.length === b.guide.length &&
    a.guide.every((p, i) => {
      const q = b.guide[i];
      return q !== undefined && sameVec(p, q);
    })
  );
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.every((v, i) => Object.is(v, b[i]));

/**
 * The pattern with the parameter set to `value` (spec 12, "Platné hodnoty"), or null when the
 * value is invalid or the parameter is not one of the pattern (a mirror has none; spacing2 and
 * angle2 need the second direction). count2 = 1 removes the second direction, count2 ≥ 2 without
 * it adds one across direction 1 (angle1 + π/2) at spacing1.
 */
export function withPatternParam(
  pattern: SketchPattern,
  param: PatternParam,
  value: number,
): SketchPattern | null {
  const candidate = candidateWith(pattern, param, value);
  return candidate !== null && patternParamsValid(candidate) ? freezePattern(candidate) : null;
}

/** The pattern with the parameter set, not yet checked; null when the parameter is not one of it. */
function candidateWith(
  pattern: SketchPattern,
  param: PatternParam,
  value: number,
): SketchPattern | null {
  switch (pattern.kind) {
    case 'mirror':
      return null;
    case 'circularPattern':
      if (param === 'count') return { ...pattern, count: value };
      if (param === 'angle') return { ...pattern, angle: value };
      return null;
    case 'linearPattern':
      return linearWith(pattern, param, value);
  }
}

function linearWith(
  pattern: SketchLinearPattern,
  param: PatternParam,
  value: number,
): SketchLinearPattern | null {
  const { direction2, ...rest } = pattern;
  if (param === 'count2') {
    if (value === 1) return rest;
    const d1 = pattern.direction1;
    const base = direction2 ?? { angle: d1.angle + Math.PI / 2, spacing: d1.spacing, count: 2 };
    return { ...pattern, direction2: { ...base, count: value } };
  }
  const target = DIRECTION_FIELDS[param];
  if (target === undefined) return null;
  const [n, field] = target;
  const direction = n === 1 ? pattern.direction1 : direction2;
  if (direction === undefined) return null;
  const next: PatternDirection = { ...direction, [field]: value };
  return n === 1 ? { ...pattern, direction1: next } : { ...pattern, direction2: next };
}

/** The pattern frozen with its sources and directions, like removeItems. */
function freezePattern(pattern: SketchPattern): SketchPattern {
  const sources = Object.freeze([...pattern.sources]);
  if (pattern.kind !== 'linearPattern') return Object.freeze({ ...pattern, sources });
  const { direction2, ...rest } = pattern;
  return Object.freeze({
    ...rest,
    sources,
    direction1: Object.freeze({ ...pattern.direction1 }),
    ...(direction2 === undefined ? {} : { direction2: Object.freeze({ ...direction2 }) }),
  });
}
