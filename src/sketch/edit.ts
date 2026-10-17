import { assert, assertNever } from '@/core';
import { pointsById } from './points';
import { isLineCarrier, isPattern } from './model';
import type {
  DimensionKind,
  GeometricConstraintKind,
  DimensionConstraint,
  SketchConstraint,
  SketchConstraintDraft,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SketchPattern,
  SketchPoint,
  SketchXLine,
} from './model';

// Pure editing helpers of the sketcher (spec 12 "Geometrie a pomůcky editace"). They return new
// data; interaction writes it through FeatureEditSession.setParams.

/** Below this a measured dimension is degenerate (spec 12). */
const MIN_DIMENSION = 1e-9;

const isRound = (e: SketchEntity): boolean => e.kind === 'circle' || e.kind === 'arc';
const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point' && !isPattern(e);

/** The end points of a spline (first and last pole or fit point), or undefined for other entities. */
function splineEnds(e: SketchEntity): readonly SketchEntityId[] | undefined {
  const points = e.kind === 'bspline' ? e.poles : e.kind === 'fitSpline' ? e.fit : undefined;
  if (points === undefined) return undefined;
  return points.filter((_, i) => i === 0 || i === points.length - 1);
}

/** A line and a spline (either order) where the line shares a point with an end of the spline. */
function lineAtSplineEnd(first: SketchEntity, second: SketchEntity): boolean {
  const [line, spline] = first.kind === 'line' ? [first, second] : [second, first];
  if (line.kind !== 'line') return false;
  const ends = splineEnds(spline);
  return ends !== undefined && (ends.includes(line.p1) || ends.includes(line.p2));
}

/**
 * The constraint for the selected entities (in selection order), or null when the selection does
 * not fit or contains a pattern (M36). Onshape's convention for the M26 kinds: coincident of a
 * point and a curve is pointOnCurve, horizontal/vertical of two points is hAlign/vAlign.
 */
export function constraintFor(
  kind: GeometricConstraintKind,
  selected: readonly SketchEntity[],
): SketchConstraintDraft | null {
  if (selected.some(isPattern)) return null;
  if (kind === 'symmetric') return symmetricFor(selected);
  const [first, second] = selected;
  if (selected.length === 1 && first !== undefined) {
    if ((kind === 'horizontal' || kind === 'vertical') && isLineCarrier(first)) {
      return { kind, line: first.id };
    }
    if (kind === 'fix' && first.kind === 'point') return { kind, point: first.id };
    return null;
  }
  if (selected.length !== 2 || first === undefined || second === undefined) return null;
  if (first.id === second.id) return null;
  const a = first.id;
  const b = second.id;
  const points = selected.filter((e) => e.kind === 'point').length;
  const lines = selected.filter((e) => e.kind === 'line').length;
  const carriers = selected.filter(isLineCarrier).length;
  const rounds = selected.filter(isRound).length;
  switch (kind) {
    case 'coincident':
      if (points === 2) return { kind, a, b };
      // Any curve, a spline (M29) and an xline (M31) too; not a point of the curve itself.
      return pointOn(
        first,
        second,
        () => true,
        (point, curve) => ({
          kind: 'pointOnCurve',
          point,
          curve,
        }),
      );
    case 'horizontal':
      return points === 2 ? { kind: 'hAlign', a, b } : null;
    case 'vertical':
      return points === 2 ? { kind: 'vAlign', a, b } : null;
    case 'parallel':
    case 'perpendicular':
      return carriers === 2 ? { kind, a, b } : null;
    case 'equal':
      // Lengths: an xline has none.
      return lines === 2 || rounds === 2 ? { kind, a, b } : null;
    case 'tangent':
      return rounds === 2 || (carriers === 1 && rounds === 1) || lineAtSplineEnd(first, second)
        ? { kind, a, b }
        : null;
    case 'midpoint':
      return pointOn(
        first,
        second,
        (e) => e.kind === 'line',
        (point, line) => ({ kind, point, line }),
      );
    case 'fix':
      return null;
    default:
      return assertNever(kind);
  }
}

/** symmetric (M36): two different points and an axis line, in this order; no point of the axis. */
function symmetricFor(selected: readonly SketchEntity[]): SketchConstraintDraft | null {
  const [a, b, axis] = selected;
  if (selected.length !== 3 || a?.kind !== 'point' || b?.kind !== 'point') return null;
  if (axis?.kind !== 'line' || a.id === b.id) return null;
  const ends = curvePoints(axis);
  if (ends.includes(a.id) || ends.includes(b.id)) return null;
  return { kind: 'symmetric', a: a.id, b: b.id, axis: axis.id };
}

/**
 * A constraint of a point and a curve selected in either order: null unless one is a point and
 * the other a curve accepted by `accepts`, and the point does not define the curve.
 */
function pointOn(
  first: SketchEntity,
  second: SketchEntity,
  accepts: (curve: SketchCurve) => boolean,
  make: (point: SketchEntityId, curve: SketchEntityId) => SketchConstraintDraft,
): SketchConstraintDraft | null {
  const [point, curve] = first.kind === 'point' ? [first, second] : [second, first];
  if (point.kind !== 'point' || !isCurve(curve) || !accepts(curve)) return null;
  if (curvePoints(curve).includes(point.id)) return null;
  return make(point.id, curve.id);
}

/**
 * The dimension for the selected entities: 1 line → distance(p1, p2); 1 circle/arc → radius;
 * 2 points → distance. value = the measured value; ≤ 1e-9 → null. An xline has no length → null;
 * a pattern selected → null.
 */
export function dimensionFor(
  selected: readonly SketchEntity[],
  data: SketchData,
): SketchConstraintDraft | null {
  if (selected.some(isPattern)) return null;
  const [first, second] = selected;
  let draft: Extract<SketchConstraintDraft, { kind: DimensionKind }> | null = null;
  if (selected.length === 1 && first !== undefined) {
    if (first.kind === 'line') draft = { kind: 'distance', a: first.p1, b: first.p2, value: 0 };
    else if (first.kind === 'circle' || first.kind === 'arc') {
      draft = { kind: 'radius', curve: first.id, value: 0 };
    }
  } else if (
    selected.length === 2 &&
    first?.kind === 'point' &&
    second?.kind === 'point' &&
    first.id !== second.id
  ) {
    draft = { kind: 'distance', a: first.id, b: second.id, value: 0 };
  }
  if (draft === null) return null;
  const value = measureDraft(data, draft);
  return value > MIN_DIMENSION ? { ...draft, value } : null;
}

/** The current value of a dimension measured on the geometry (not the stored value). */
export function measure(data: SketchData, c: DimensionConstraint): number {
  return measureDraft(data, c);
}

/** measure for a draft (no id yet); internal to sketch (dimension-placement). */
export function measureDraft(
  data: SketchData,
  c: Extract<SketchConstraintDraft, { kind: DimensionKind }>,
): number {
  const points = pointsById(data);
  const point = (id: SketchEntityId): SketchPoint => {
    const p = points.get(id);
    assert(p !== undefined, `measure: missing point '${id}'`);
    return p;
  };
  const line = (id: SketchEntityId): readonly [SketchPoint, SketchPoint] => {
    const l = data.entities.find((e) => e.id === id);
    assert(l !== undefined && isLineCarrier(l), `measure: '${id}' is not a line`);
    return [point(l.p1), point(l.p2)];
  };
  const radius = (id: SketchEntityId): number => {
    const curve = data.entities.find((e) => e.id === id);
    assert(curve?.kind === 'circle' || curve?.kind === 'arc', `measure: '${id}' is not round`);
    if (curve.kind === 'circle') return curve.radius;
    const center = point(curve.center);
    const start = point(curve.start);
    return Math.hypot(start.x - center.x, start.y - center.y);
  };
  switch (c.kind) {
    case 'distance':
    case 'hDistance':
    case 'vDistance': {
      const a = point(c.a);
      const b = point(c.b);
      if (c.kind === 'hDistance') return Math.abs(b.x - a.x);
      if (c.kind === 'vDistance') return Math.abs(b.y - a.y);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case 'pointLineDistance':
      return pointLineDistance(point(c.point), line(c.line));
    case 'angle': {
      // The angle between the directions p1→p2 (each reversed by its flag), in [0, π].
      const [a1, a2] = line(c.a);
      const [b1, b2] = line(c.b);
      const sa = c.reverseA === true ? -1 : 1;
      const sb = c.reverseB === true ? -1 : 1;
      const ax = sa * (a2.x - a1.x);
      const ay = sa * (a2.y - a1.y);
      const bx = sb * (b2.x - b1.x);
      const by = sb * (b2.y - b1.y);
      return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
    }
    case 'radius':
      return radius(c.curve);
    case 'diameter':
      return 2 * radius(c.curve);
    case 'offset': {
      // The first pair: a line copy by its p1 from the source line, a round one by the radii.
      const [pair] = c.pairs;
      assert(pair !== undefined, 'measure: an offset without pairs');
      const copy = data.entities.find((e) => e.id === pair.copy);
      if (copy?.kind === 'line') return pointLineDistance(point(copy.p1), line(pair.source));
      return Math.abs(radius(pair.copy) - radius(pair.source));
    }
    default:
      return assertNever(c);
  }
}

/** |cross(p − p1, p2 − p1)| / |p2 − p1|: the distance to the infinite line (NaN for a zero length). */
function pointLineDistance(p: SketchPoint, [p1, p2]: readonly [SketchPoint, SketchPoint]): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.abs((p.x - p1.x) * dy - (p.y - p1.y) * dx) / Math.hypot(dx, dy);
}

/** A curve whose construction flag can be toggled: all but an xline (always construction). */
type TogglableCurve = Exclude<SketchCurve, SketchXLine>;

const isTogglable = (e: SketchEntity): e is TogglableCurve => isCurve(e) && e.kind !== 'xline';

function withoutConstruction(c: TogglableCurve): TogglableCurve {
  switch (c.kind) {
    case 'line':
      return { kind: c.kind, id: c.id, p1: c.p1, p2: c.p2 };
    case 'circle':
      return { kind: c.kind, id: c.id, center: c.center, radius: c.radius };
    case 'arc':
      return { kind: c.kind, id: c.id, center: c.center, start: c.start, end: c.end };
    case 'bspline':
      return { kind: c.kind, id: c.id, degree: c.degree, poles: c.poles, knots: c.knots };
    case 'fitSpline':
      return {
        kind: c.kind,
        id: c.id,
        degree: c.degree,
        fit: c.fit,
        params: c.params,
        poles: c.poles,
        knots: c.knots,
      };
    default:
      return assertNever(c);
  }
}

/**
 * Point ids a curve is defined by: line and xline [p1, p2], circle [center], arc [center, start,
 * end].
 */
export function curvePoints(c: SketchCurve): readonly SketchEntityId[] {
  switch (c.kind) {
    case 'line':
    case 'xline':
      return [c.p1, c.p2];
    case 'circle':
      return [c.center];
    case 'arc':
      return [c.center, c.start, c.end];
    case 'bspline':
      return c.poles;
    case 'fitSpline':
      return c.fit;
    default:
      return assertNever(c);
  }
}

/**
 * Entity ids a constraint refers to: [a, b] for the constraints of two entities (coincident,
 * hAlign and vAlign included), [line] for horizontal and vertical, [point] for fix, [curve] for
 * radius, [point, curve] for pointOnCurve, [point, line] for midpoint, [a, b, axis] for
 * symmetric, [source, copy, …] of every pair for offset.
 */
export function constraintTargets(c: SketchConstraint): readonly SketchEntityId[] {
  switch (c.kind) {
    case 'coincident':
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'tangent':
    case 'distance':
    case 'hAlign':
    case 'vAlign':
    case 'hDistance':
    case 'vDistance':
    case 'angle':
      return [c.a, c.b];
    case 'symmetric':
      return [c.a, c.b, c.axis];
    case 'pointOnCurve':
      return [c.point, c.curve];
    case 'midpoint':
      return [c.point, c.line];
    case 'horizontal':
    case 'vertical':
      return [c.line];
    case 'fix':
      return [c.point];
    case 'pointLineDistance':
      return [c.point, c.line];
    case 'radius':
    case 'diameter':
      return [c.curve];
    case 'offset':
      return c.pairs.flatMap((p) => [p.source, p.copy]);
    default:
      return assertNever(c);
  }
}

/**
 * Removes items with a cascade; the order of the rest does not change. Unknown ids are ignored.
 * (1) selected constraints; (2) selected entities, with a point also the curves using it;
 * (2a) removed sources leave the sources of patterns, a pattern without sources goes; (2b) a
 * pattern goes with its axis or center; (3) points of removed curves that no remaining curve uses
 * and that are no center of a remaining pattern; (4) constraints on removed entities, an offset
 * loses only the pairs with a removed curve and goes with its last pair (M35). Steps 2–3 repeat
 * until nothing more goes (a removed curve empties a pattern, which frees its center).
 */
export function removeItems(data: SketchData, ids: readonly SketchItemId[]): SketchData {
  const selected = new Set<string>(ids);
  const removed = new Set<string>();
  for (const e of data.entities) if (selected.has(e.id)) removed.add(e.id);
  const curves = data.entities.filter(isCurve);
  const patterns = data.entities.filter(isPattern);
  let before = -1;
  while (removed.size !== before) {
    before = removed.size;
    for (const c of curves) {
      if (curvePoints(c).some((p) => removed.has(p))) removed.add(c.id);
    }
    for (const p of patterns) {
      const anchor = patternAnchor(p);
      const anchorRemoved = anchor !== undefined && removed.has(anchor);
      if (anchorRemoved || p.sources.every((s) => removed.has(s))) removed.add(p.id);
    }
    const stillUsed = new Set<string>([
      ...curves.filter((c) => !removed.has(c.id)).flatMap((c) => curvePoints(c)),
      ...patterns.flatMap((p) =>
        p.kind === 'circularPattern' && !removed.has(p.id) ? [p.center] : [],
      ),
    ]);
    for (const c of curves) {
      if (!removed.has(c.id)) continue;
      for (const p of curvePoints(c)) if (!stillUsed.has(p)) removed.add(p);
    }
  }
  const entities = data.entities.flatMap((e): SketchEntity[] => {
    if (removed.has(e.id)) return [];
    if (!isPattern(e) || !e.sources.some((s) => removed.has(s))) return [e];
    return [
      Object.freeze({ ...e, sources: Object.freeze(e.sources.filter((s) => !removed.has(s))) }),
    ];
  });
  const constraints = data.constraints.flatMap((c): SketchConstraint[] => {
    if (selected.has(c.id)) return [];
    if (c.kind === 'offset') return withoutRemovedPairs(c, removed);
    return constraintTargets(c).some((t) => removed.has(t)) ? [] : [c];
  });
  return Object.freeze({
    entities: Object.freeze(entities),
    constraints: Object.freeze(constraints),
  });
}

/** The offset without the pairs with a removed curve: itself when none, nothing when all. */
function withoutRemovedPairs(
  c: Extract<SketchConstraint, { kind: 'offset' }>,
  removed: ReadonlySet<string>,
): SketchConstraint[] {
  const pairs = c.pairs.filter((p) => !removed.has(p.source) && !removed.has(p.copy));
  if (pairs.length === c.pairs.length) return [c];
  if (pairs.length === 0) return [];
  return [Object.freeze({ ...c, pairs: Object.freeze(pairs) })];
}

/**
 * The entity a pattern stands on besides its sources: the axis of a mirror, the center of a
 * circular pattern; a linear pattern has none.
 */
function patternAnchor(p: SketchPattern): SketchEntityId | undefined {
  switch (p.kind) {
    case 'mirror':
      return p.axis;
    case 'circularPattern':
      return p.center;
    case 'linearPattern':
      return undefined;
    default:
      return assertNever(p);
  }
}

/**
 * Toggles construction of the selected curves: all construction → all normal, otherwise all
 * construction. Points, patterns, constraints and xlines (always construction, M31) are ignored.
 * A normal curve has no `construction` field.
 */
export function toggleConstruction(data: SketchData, ids: readonly SketchItemId[]): SketchData {
  const selected = new Set<string>(ids);
  const targets = data.entities.filter((e) => isTogglable(e) && selected.has(e.id));
  if (targets.length === 0) return data;
  const makeConstruction = !targets.every((c) => isTogglable(c) && c.construction === true);
  const entities = data.entities.map((e): SketchEntity => {
    if (!isTogglable(e) || !selected.has(e.id)) return e;
    if (makeConstruction) return Object.freeze({ ...e, construction: true });
    // Rebuilt without the field: a normal curve has no `construction` at all.
    return Object.freeze(withoutConstruction(e));
  });
  return Object.freeze({ entities: Object.freeze(entities), constraints: data.constraints });
}
