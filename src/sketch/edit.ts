import { assert, assertNever } from '@/core';
import { pointsById } from './geometry';
import type {
  DimensionKind,
  GeometricConstraintKind,
  SketchConstraint,
  SketchConstraintDraft,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SketchPoint,
} from './model';

// Pure editing helpers of the sketcher (spec 12 "Geometrie a pomůcky editace"). They return new
// data; interaction writes it through FeatureEditSession.setParams.

/** Below this a measured dimension is degenerate (spec 12). */
const MIN_DIMENSION = 1e-9;

const isRound = (e: SketchEntity): boolean => e.kind === 'circle' || e.kind === 'arc';

/** The constraint for the selected entities (in selection order), or null when the selection does not fit. */
export function constraintFor(
  kind: GeometricConstraintKind,
  selected: readonly SketchEntity[],
): SketchConstraintDraft | null {
  const [first, second] = selected;
  if (selected.length === 1 && first !== undefined) {
    if ((kind === 'horizontal' || kind === 'vertical') && first.kind === 'line') {
      return { kind, line: first.id };
    }
    if (kind === 'fix' && first.kind === 'point') return { kind, point: first.id };
    return null;
  }
  if (selected.length !== 2 || first === undefined || second === undefined) return null;
  if (first.id === second.id) return null;
  const a = first.id;
  const b = second.id;
  const lines = selected.filter((e) => e.kind === 'line').length;
  const rounds = selected.filter(isRound).length;
  switch (kind) {
    case 'coincident':
      return first.kind === 'point' && second.kind === 'point' ? { kind, a, b } : null;
    case 'parallel':
    case 'perpendicular':
      return lines === 2 ? { kind, a, b } : null;
    case 'equal':
      return lines === 2 || rounds === 2 ? { kind, a, b } : null;
    case 'tangent':
      return rounds === 2 || (lines === 1 && rounds === 1) ? { kind, a, b } : null;
    case 'horizontal':
    case 'vertical':
    case 'fix':
      return null;
    default:
      return assertNever(kind);
  }
}

/**
 * The dimension for the selected entities: 1 line → distance(p1, p2); 1 circle/arc → radius;
 * 2 points → distance. value = the measured value; ≤ 1e-9 → null.
 */
export function dimensionFor(
  selected: readonly SketchEntity[],
  data: SketchData,
): SketchConstraintDraft | null {
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
export function measure(
  data: SketchData,
  c: Extract<SketchConstraint, { kind: DimensionKind }>,
): number {
  return measureDraft(data, c);
}

function measureDraft(
  data: SketchData,
  c: Extract<SketchConstraintDraft, { kind: DimensionKind }>,
): number {
  const points = pointsById(data);
  const point = (id: SketchEntityId): SketchPoint => {
    const p = points.get(id);
    assert(p !== undefined, `measure: missing point '${id}'`);
    return p;
  };
  if (c.kind === 'distance') {
    const a = point(c.a);
    const b = point(c.b);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const curve = data.entities.find((e) => e.id === c.curve);
  assert(curve?.kind === 'circle' || curve?.kind === 'arc', `measure: '${c.curve}' is not round`);
  if (curve.kind === 'circle') return curve.radius;
  const center = point(curve.center);
  const start = point(curve.start);
  return Math.hypot(start.x - center.x, start.y - center.y);
}

function withoutConstruction(c: SketchCurve): SketchCurve {
  switch (c.kind) {
    case 'line':
      return { kind: c.kind, id: c.id, p1: c.p1, p2: c.p2 };
    case 'circle':
      return { kind: c.kind, id: c.id, center: c.center, radius: c.radius };
    case 'arc':
      return { kind: c.kind, id: c.id, center: c.center, start: c.start, end: c.end };
    default:
      return assertNever(c);
  }
}

/** Point ids a curve uses. */
function curvePoints(c: SketchCurve): readonly SketchEntityId[] {
  switch (c.kind) {
    case 'line':
      return [c.p1, c.p2];
    case 'circle':
      return [c.center];
    case 'arc':
      return [c.center, c.start, c.end];
    default:
      return assertNever(c);
  }
}

/** Entity ids a constraint refers to. */
function constraintTargets(c: SketchConstraint): readonly SketchEntityId[] {
  switch (c.kind) {
    case 'coincident':
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'tangent':
    case 'distance':
      return [c.a, c.b];
    case 'horizontal':
    case 'vertical':
      return [c.line];
    case 'fix':
      return [c.point];
    case 'radius':
      return [c.curve];
    default:
      return assertNever(c);
  }
}

const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point';

/**
 * Removes items with a cascade; the order of the rest does not change. Unknown ids are ignored.
 * (1) selected constraints; (2) selected entities, with a point also the curves using it;
 * (3) points of removed curves that no remaining curve uses; (4) constraints on removed entities.
 */
export function removeItems(data: SketchData, ids: readonly SketchItemId[]): SketchData {
  const selected = new Set<string>(ids);
  const removed = new Set<string>();
  for (const e of data.entities) if (selected.has(e.id)) removed.add(e.id);
  const curves = data.entities.filter(isCurve);
  for (const c of curves) {
    if (curvePoints(c).some((p) => removed.has(p))) removed.add(c.id);
  }
  const stillUsed = new Set<string>(
    curves.filter((c) => !removed.has(c.id)).flatMap((c) => curvePoints(c)),
  );
  for (const c of curves) {
    if (!removed.has(c.id)) continue;
    for (const p of curvePoints(c)) if (!stillUsed.has(p)) removed.add(p);
  }
  return Object.freeze({
    entities: Object.freeze(data.entities.filter((e) => !removed.has(e.id))),
    constraints: Object.freeze(
      data.constraints.filter(
        (c) => !selected.has(c.id) && !constraintTargets(c).some((t) => removed.has(t)),
      ),
    ),
  });
}

/**
 * Toggles construction of the selected curves: all construction → all normal, otherwise all
 * construction. Points and constraints are ignored. A normal curve has no `construction` field.
 */
export function toggleConstruction(data: SketchData, ids: readonly SketchItemId[]): SketchData {
  const selected = new Set<string>(ids);
  const targets = data.entities.filter((e) => isCurve(e) && selected.has(e.id));
  if (targets.length === 0) return data;
  const makeConstruction = !targets.every((c) => isCurve(c) && c.construction === true);
  const entities = data.entities.map((e): SketchEntity => {
    if (!isCurve(e) || !selected.has(e.id)) return e;
    if (makeConstruction) return Object.freeze({ ...e, construction: true });
    // Rebuilt without the field: a normal curve has no `construction` at all.
    return Object.freeze(withoutConstruction(e));
  });
  return Object.freeze({ entities: Object.freeze(entities), constraints: data.constraints });
}
