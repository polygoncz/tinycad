import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { SketchData } from './model';

// Shape and invariant checks of sketch data (spec 12 "Kontrola dat"). The only trusted place
// where raw params become typed SketchData: ids are branded here, nowhere else.

export interface SketchIssue {
  readonly path: 'entities' | 'constraints';
  readonly index: number;
  readonly code: 'sketch.invalidEntity' | 'sketch.invalidConstraint';
}

/** Relative tolerance of equal arc radii and the smallest arc radius (spec 12). */
const ARC_RADIUS_TOLERANCE = 1e-6;
const MIN_ARC_RADIUS = 1e-9;

type Fields = Readonly<Record<string, unknown>>;

/** Required and optional fields of each entity kind, besides `kind`. */
const ENTITY_FIELDS: Readonly<Record<string, { required: string[]; optional: string[] }>> = {
  point: { required: ['id', 'x', 'y'], optional: [] },
  line: { required: ['id', 'p1', 'p2'], optional: ['construction'] },
  circle: { required: ['id', 'center', 'radius'], optional: ['construction'] },
  arc: { required: ['id', 'center', 'start', 'end'], optional: ['construction'] },
};

/** Entity kind groups a constraint field may refer to. */
type Target = 'point' | 'line' | 'round' | 'curve';
const ROUND = new Set(['circle', 'arc']);
const CURVE = new Set(['line', 'circle', 'arc']);

/** The fields of each curve kind that refer to its defining points (curvePoints on raw data). */
const DEFINING_POINT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  line: ['p1', 'p2'],
  circle: ['center'],
  arc: ['center', 'start', 'end'],
};

/**
 * Fields of each constraint kind besides `kind` and `id`; a ref field lists the entity kind it
 * needs. Pair kinds (equal, tangent) need an extra rule on the combination, see pairAllowed;
 * pointOnCurve and midpoint one on the point, see definesCurve.
 */
const CONSTRAINT_FIELDS: Readonly<Record<string, Readonly<Record<string, Target | 'value'>>>> = {
  coincident: { a: 'point', b: 'point' },
  horizontal: { line: 'line' },
  vertical: { line: 'line' },
  parallel: { a: 'line', b: 'line' },
  perpendicular: { a: 'line', b: 'line' },
  equal: { a: 'line', b: 'line' },
  tangent: { a: 'line', b: 'line' },
  pointOnCurve: { point: 'point', curve: 'curve' },
  midpoint: { point: 'point', line: 'line' },
  hAlign: { a: 'point', b: 'point' },
  vAlign: { a: 'point', b: 'point' },
  fix: { point: 'point' },
  distance: { a: 'point', b: 'point', value: 'value' },
  radius: { curve: 'round', value: 'value' },
};

/** Ok = the same values typed (the trusted place instead of casting ids). Reports every problem. */
export function parseSketchData(
  entities: unknown,
  constraints: unknown,
): Result<SketchData, readonly SketchIssue[]> {
  const issues: SketchIssue[] = [];
  const entityIssue = (index: number) =>
    issues.push({ path: 'entities', index, code: 'sketch.invalidEntity' });
  const constraintIssue = (index: number) =>
    issues.push({ path: 'constraints', index, code: 'sketch.invalidConstraint' });

  const entityItems = Array.isArray(entities) ? (entities as readonly unknown[]) : undefined;
  const constraintItems = Array.isArray(constraints)
    ? (constraints as readonly unknown[])
    : undefined;
  if (entityItems === undefined) entityIssue(-1);

  // References may point to later entities, so the targets are collected first:
  // id → the first entity with that id (a duplicate is reported at itself).
  const targets = new Map<string, Fields>();
  for (const item of entityItems ?? []) {
    if (isRecord(item) && isId(item.id) && !targets.has(item.id)) targets.set(item.id, item);
  }

  const used = new Set<string>();
  for (const [index, item] of (entityItems ?? []).entries()) {
    if (!entityValid(item, targets, used)) entityIssue(index);
  }

  if (constraintItems === undefined) constraintIssue(-1);
  for (const [index, item] of (constraintItems ?? []).entries()) {
    if (!constraintValid(item, targets, used)) constraintIssue(index);
  }

  if (issues.length > 0 || entityItems === undefined || constraintItems === undefined) {
    return err(issues);
  }
  // Every item passed the checks above, which mirror SketchData exactly.
  return ok({ entities: entityItems, constraints: constraintItems } as SketchData);
}

/** Checks one entity; registers its id in `used` (also an invalid one, so a later duplicate is caught). */
function entityValid(
  item: unknown,
  targets: ReadonlyMap<string, Fields>,
  used: Set<string>,
): boolean {
  if (!isRecord(item)) return false;
  const idFresh = claimId(item.id, used);
  const kind = item.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(ENTITY_FIELDS, kind)) return false;
  const fields = ENTITY_FIELDS[kind];
  if (fields === undefined || !hasExactly(item, fields.required, fields.optional)) return false;
  if (!idFresh) return false;
  if (Object.hasOwn(item, 'construction') && item.construction !== true) return false;
  const point = (ref: unknown): Fields | undefined => {
    if (typeof ref !== 'string') return undefined;
    const target = targets.get(ref);
    return target?.kind === 'point' ? target : undefined;
  };
  switch (kind) {
    case 'point':
      return isFiniteNumber(item.x) && isFiniteNumber(item.y);
    case 'line':
      return point(item.p1) !== undefined && point(item.p2) !== undefined && item.p1 !== item.p2;
    case 'circle':
      return point(item.center) !== undefined && isFiniteNumber(item.radius) && item.radius > 0;
    case 'arc': {
      const c = point(item.center);
      const s = point(item.start);
      const e = point(item.end);
      if (c === undefined || s === undefined || e === undefined) return false;
      if (new Set([item.center, item.start, item.end]).size !== 3) return false;
      return arcRadiiValid(c, s, e);
    }
    default:
      return false;
  }
}

/** |end − center| = |start − center| within the relative tolerance, radius not degenerate. */
function arcRadiiValid(center: Fields, start: Fields, end: Fields): boolean {
  const c = coordinates(center);
  const s = coordinates(start);
  const e = coordinates(end);
  // A point with bad coordinates is reported at itself; the arc cannot be judged.
  if (c === undefined || s === undefined || e === undefined) return true;
  const rStart = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const rEnd = Math.hypot(e[0] - c[0], e[1] - c[1]);
  return (
    rStart > MIN_ARC_RADIUS && Math.abs(rEnd - rStart) <= ARC_RADIUS_TOLERANCE * Math.max(1, rStart)
  );
}

function coordinates(point: Fields): readonly [number, number] | undefined {
  const { x, y } = point;
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : undefined;
}

function constraintValid(
  item: unknown,
  targets: ReadonlyMap<string, Fields>,
  used: Set<string>,
): boolean {
  if (!isRecord(item)) return false;
  const idFresh = claimId(item.id, used);
  const kind = item.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(CONSTRAINT_FIELDS, kind)) return false;
  const fields = CONSTRAINT_FIELDS[kind];
  if (fields === undefined || !hasExactly(item, ['id', ...Object.keys(fields)], [])) return false;
  if (!idFresh) return false;

  const refKinds: string[] = [];
  const refs: unknown[] = [];
  for (const [field, need] of Object.entries(fields)) {
    const v = item[field];
    if (need === 'value') {
      if (!isFiniteNumber(v) || v <= 0) return false;
      continue;
    }
    const target = typeof v === 'string' ? targets.get(v) : undefined;
    const targetKind = target?.kind;
    if (typeof targetKind !== 'string') return false;
    refKinds.push(targetKind);
    refs.push(v);
  }
  if (refs.length === 2 && refs[0] === refs[1]) return false;
  if (kind === 'equal' || kind === 'tangent') return pairAllowed(kind, refKinds);
  const kindsMatch = Object.values(fields)
    .filter((need) => need !== 'value')
    .every((need, i) => matches(need, refKinds[i]));
  if (!kindsMatch) return false;
  if (kind === 'pointOnCurve' || kind === 'midpoint') {
    const [point, curve] = refs;
    const target = typeof curve === 'string' ? targets.get(curve) : undefined;
    return target !== undefined && !definesCurve(point, target);
  }
  return true;
}

/** Whether the point id is one of the defining points of the (raw) curve. */
function definesCurve(point: unknown, curve: Fields): boolean {
  const fields = typeof curve.kind === 'string' ? DEFINING_POINT_FIELDS[curve.kind] : undefined;
  return (fields ?? []).some((field) => curve[field] === point);
}

/** equal: two lines or two rounds; tangent: a line and a round (any order) or two rounds. */
function pairAllowed(kind: 'equal' | 'tangent', [a, b]: readonly string[]): boolean {
  const lines = [a, b].filter((k) => k === 'line').length;
  const rounds = [a, b].filter((k) => k !== undefined && ROUND.has(k)).length;
  if (kind === 'equal') return lines === 2 || rounds === 2;
  return rounds === 2 || (lines === 1 && rounds === 1);
}

function matches(need: Target | 'value', kind: string | undefined): boolean {
  if (kind === undefined) return false;
  if (need === 'round') return ROUND.has(kind);
  if (need === 'curve') return CURVE.has(kind);
  return need === kind;
}

/** True when the id is a non-empty string not used before; remembers it either way. */
function claimId(id: unknown, used: Set<string>): boolean {
  if (!isId(id)) return false;
  if (used.has(id)) return false;
  used.add(id);
  return true;
}

function hasExactly(
  item: Fields,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set(['kind', ...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(item, key)) &&
    Object.keys(item).every((key) => allowed.has(key))
  );
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
