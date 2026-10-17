import { assertNever } from '@/core';
import type { Vec2 } from '@/core';
import { samePoint } from './curve-param';
import { curve2 } from './geometry';
import type { Curve2 } from './geometry';
import type { OffsetCurve2 } from './geometry-port';
import type {
  SketchConstraint,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchPoint,
} from './model';
import { isCurveEntity } from './model';
import { pointsById } from './points';
import { endIds } from './trim';
import type { IdSource, SketchEdit } from './trim';

// Offset of a chain of sketch curves (spec 12 "Offset (M35)"): the chain the tool picks, the
// input of the kernel along it, and the edit that writes the curves of the kernel's answer as
// new entities held by an associative offset constraint. Pure functions over the data rules of
// trim (M33): new points before the curves, ids from an IdSource.

/** A chain of curves joined end to end in points of exactly two curves. */
export interface Chain {
  /** The curves in the order of the walk; reversed = the curve runs against its own direction. */
  readonly curves: readonly { readonly id: SketchEntityId; readonly reversed: boolean }[];
  readonly closed: boolean;
}

export interface OffsetRequest {
  readonly chain: Chain;
  /** ≠ 0: closed > 0 outwards, open > 0 to the right of the walk. */
  readonly distance: number;
  /** SketchGeometry.offset(chainCurves(data, chain), chain.closed, distance). */
  readonly result: readonly OffsetCurve2[];
}

type Link = Chain['curves'][number];

/**
 * The chain through the curve: from it over the end points in which exactly two curves meet
 * (curves of the data without infinite lines, of the same construction state as the curve), both
 * ways. A circle is a closed chain on its own. Null for an id that is not such a curve. Frozen.
 */
export function chainOf(data: SketchData, curve: SketchEntityId): Chain | null {
  const start = data.entities.find((e) => e.id === curve);
  if (start === undefined || !chainable(start)) return null;
  const link = (id: SketchEntityId, reversed: boolean): Link => Object.freeze({ id, reversed });
  if (start.kind === 'circle') {
    return Object.freeze({ curves: Object.freeze([link(start.id, false)]), closed: true });
  }

  // The curves of the same construction state by their end points.
  const construction = start.construction === true;
  const users = new Map<SketchEntityId, SketchCurve[]>();
  for (const e of data.entities) {
    if (!chainable(e) || (e.construction === true) !== construction) continue;
    for (const end of new Set(endIds(e))) users.set(end, [...(users.get(end) ?? []), e]);
  }
  /** The other curve in the point when exactly two meet there. */
  const next = (from: SketchCurve, at: SketchEntityId): SketchCurve | null => {
    const here = users.get(at) ?? [];
    if (here.length !== 2) return null;
    return here.find((c) => c.id !== from.id) ?? null;
  };

  const [first, last] = endIds(start);
  if (first === undefined || last === undefined) return null;
  const visited = new Set<SketchEntityId>([start.id]);
  // Forward from the end of the curve: each next curve continues from the shared point.
  const forward: Link[] = [link(start.id, false)];
  let closed = false;
  let current: SketchCurve = start;
  let tail = last;
  for (;;) {
    const c = next(current, tail);
    if (c === null) break;
    if (c.id === start.id) {
      closed = true;
      break;
    }
    if (visited.has(c.id)) break;
    visited.add(c.id);
    const [a, b] = endIds(c);
    if (a === undefined || b === undefined) break;
    const reversed = a !== tail;
    forward.push(link(c.id, reversed));
    tail = reversed ? a : b;
    current = c;
  }
  // Backward from the start of the curve: each previous curve runs into the shared point.
  const backward: Link[] = [];
  if (!closed) {
    current = start;
    let head = first;
    for (;;) {
      const c = next(current, head);
      if (c === null || visited.has(c.id)) break;
      visited.add(c.id);
      const [a, b] = endIds(c);
      if (a === undefined || b === undefined) break;
      const reversed = b !== head;
      backward.unshift(link(c.id, reversed));
      head = reversed ? b : a;
      current = c;
    }
  }
  return Object.freeze({ curves: Object.freeze([...backward, ...forward]), closed });
}

/**
 * The input of SketchGeometry.offset: the curves of the chain with their ids, each oriented along
 * the walk (a reversed line from p2 to p1, an arc clockwise from its end to its start, a spline
 * with its poles backwards and its knots mirrored). A missing curve is a programming error.
 */
export function chainCurves(data: SketchData, chain: Chain): readonly Curve2[] {
  const points = pointsById(data);
  return Object.freeze(
    chain.curves.map(({ id, reversed }) => {
      const curve = data.entities.find((e) => e.id === id);
      if (curve === undefined || !chainable(curve)) {
        throw new Error(`chainCurves: '${id}' is no curve of the chain`);
      }
      const c = curve2(curve, points);
      return reversed ? reverse(c) : c;
    }),
  );
}

/**
 * Writes the offset: the curves of the result as new entities after the data, neighbouring
 * copies sharing their end points (new points, before the curves; a closed chain also last →
 * first), an arc or circle copy of an arc or circle around the centre point of its source, a
 * spline as a bspline with new poles. Copies take the construction state of the chain. An offset
 * constraint pairs every line, arc and circle with its copy of the same kind (only the first
 * copy of a source; a spline never), value |distance|; it is `added` (a conflict drops it and
 * the offset stays baked) and `edit`. Null for an empty result, a bad distance or a chain with a
 * curve not in the data.
 */
export function offsetEdit(data: SketchData, req: OffsetRequest, ids: IdSource): SketchEdit | null {
  const { result, chain, distance } = req;
  if (result.length === 0 || !Number.isFinite(distance) || distance === 0) return null;
  const sources = new Map<string, { readonly curve: SketchCurve; readonly reversed: boolean }>();
  for (const { id, reversed } of chain.curves) {
    const curve = data.entities.find((e) => e.id === id);
    if (curve === undefined || !chainable(curve)) return null;
    sources.set(id, { curve, reversed });
  }
  const construction =
    chain.curves.length > 0 && [...sources.values()].every((s) => s.curve.construction === true)
      ? { construction: true as const }
      : {};

  const points: SketchPoint[] = [];
  const newPoint = (p: Vec2): SketchEntityId => {
    const pid = ids.entity();
    points.push(Object.freeze({ kind: 'point', id: pid, x: p[0], y: p[1] }));
    return pid;
  };
  const original = pointsById(data);

  // The joints: joint i is the start of result[i] (and the end of result[i − 1]).
  const n = result.length;
  const joints: (SketchEntityId | null)[] = result.map((c, i) => {
    if (c.kind === 'circle') return null;
    const previous = i > 0 ? result[i - 1] : chain.closed ? result[n - 1] : undefined;
    // A closed single curve other than a circle would join itself (no such kernel answer).
    return newPoint(previous === undefined || previous === c ? startOf(c) : endOf(previous));
  });
  const jointAt = (i: number): SketchEntityId | null => joints[i] ?? null;
  const endJoint = (i: number): SketchEntityId | null => {
    if (i + 1 < n) return jointAt(i + 1);
    if (chain.closed) return jointAt(0);
    const last = result[i];
    return last === undefined || last.kind === 'circle' ? null : newPoint(endOf(last));
  };

  const curves: SketchCurve[] = [];
  const pairs: { readonly source: SketchEntityId; readonly copy: SketchEntityId }[] = [];
  const paired = new Set<string>();
  for (const [i, c] of result.entries()) {
    const source = c.source === undefined ? undefined : sources.get(c.source);
    const from = jointAt(i);
    const to = endJoint(i);
    const copyId = ids.entity();
    let copy: SketchCurve;
    let sameKind = false;
    switch (c.kind) {
      case 'line': {
        if (from === null || to === null) return null;
        // Like its source: a copy of a reversed line runs back.
        const back = source?.reversed === true;
        copy = Object.freeze({
          kind: 'line',
          id: copyId,
          p1: back ? to : from,
          p2: back ? from : to,
          ...construction,
        });
        sameKind = source?.curve.kind === 'line';
        break;
      }
      case 'arc': {
        if (from === null || to === null) return null;
        const center = sharedCenter(source?.curve, c.center, original) ?? newPoint(c.center);
        copy = Object.freeze({
          kind: 'arc',
          id: copyId,
          center,
          start: c.ccw ? from : to,
          end: c.ccw ? to : from,
          ...construction,
        });
        sameKind = source?.curve.kind === 'arc' && source.curve.center === center;
        break;
      }
      case 'circle': {
        const center = sharedCenter(source?.curve, c.center, original) ?? newPoint(c.center);
        copy = Object.freeze({
          kind: 'circle',
          id: copyId,
          center,
          radius: c.radius,
          ...construction,
        });
        sameKind = source?.curve.kind === 'circle' && source.curve.center === center;
        break;
      }
      case 'bspline': {
        if (from === null || to === null) return null;
        const spline = splineCopy(c, copyId, from, to, newPoint, construction);
        if (spline === null) return null;
        copy = spline;
        break;
      }
      default:
        return assertNever(c);
    }
    curves.push(copy);
    if (source !== undefined && sameKind && !paired.has(source.curve.id)) {
      paired.add(source.curve.id);
      pairs.push(Object.freeze({ source: source.curve.id, copy: copyId }));
    }
  }

  const offset: SketchConstraint | null =
    pairs.length === 0
      ? null
      : Object.freeze({
          kind: 'offset',
          id: ids.constraint(),
          pairs: Object.freeze(pairs),
          value: Math.abs(distance),
        });
  const entities: readonly SketchEntity[] = [...data.entities, ...points, ...curves];
  return Object.freeze({
    data: Object.freeze({
      entities: Object.freeze(entities),
      constraints: Object.freeze(
        offset === null ? data.constraints : [...data.constraints, offset],
      ),
    }),
    added: new Set(offset === null ? [] : [offset.id]),
    ...(offset === null ? {} : { edit: offset.id }),
  });
}

/** A curve that goes into a chain: a curve entity with ends or a circle, not an infinite line. */
function chainable(e: SketchEntity): e is Exclude<SketchCurve, { kind: 'xline' }> {
  return isCurveEntity(e) && e.kind !== 'xline';
}

/** The same curve run the other way. */
function reverse(c: Curve2): Curve2 {
  switch (c.kind) {
    case 'line':
      return { ...c, from: c.to, to: c.from };
    case 'arc':
      return { ...c, from: c.to, to: c.from, ccw: !c.ccw };
    case 'circle':
      return c;
    case 'bspline': {
      // Knots mirrored in their range (a sketch spline: k → 1 − k), reversed.
      const lo = c.knots[0] ?? 0;
      const hi = c.knots.at(-1) ?? 1;
      return {
        ...c,
        poles: [...c.poles].reverse(),
        knots: c.knots.map((k) => lo + hi - k).reverse(),
      };
    }
    default:
      return assertNever(c);
  }
}

function startOf(c: Exclude<Curve2, { kind: 'circle' }>): Vec2 {
  return c.kind === 'bspline' ? (c.poles[0] ?? [0, 0]) : c.from;
}

function endOf(c: Curve2): Vec2 {
  switch (c.kind) {
    case 'line':
    case 'arc':
      return c.to;
    case 'circle':
      return c.center;
    case 'bspline':
      return c.poles.at(-1) ?? [0, 0];
    default:
      return assertNever(c);
  }
}

/** The centre point of an arc or circle source lying at `center`, or null. */
function sharedCenter(
  source: SketchCurve | undefined,
  center: Vec2,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): SketchEntityId | null {
  if (source?.kind !== 'arc' && source?.kind !== 'circle') return null;
  const p = points.get(source.center);
  return p !== undefined && samePoint([p.x, p.y], center) ? source.center : null;
}

/**
 * The bspline copy: the end poles the joints, the inner poles new points; the degree of a sketch
 * spline (min(3, poles − 1)) and the ends of the knots exactly 0 and 1. Null for a malformed one.
 */
function splineCopy(
  c: Extract<Curve2, { kind: 'bspline' }>,
  id: SketchEntityId,
  from: SketchEntityId,
  to: SketchEntityId,
  newPoint: (p: Vec2) => SketchEntityId,
  construction: { readonly construction?: true },
): SketchCurve | null {
  const n = c.poles.length;
  const degree = Math.min(3, n - 1);
  if (
    (degree !== 1 && degree !== 2 && degree !== 3) ||
    c.degree !== degree ||
    c.knots.length !== n + degree + 1
  ) {
    return null;
  }
  const inner = c.poles.slice(1, -1).map(newPoint);
  const knots = c.knots.map((k, i) => (i <= degree ? 0 : i >= n ? 1 : k));
  return Object.freeze({
    kind: 'bspline',
    id,
    degree,
    poles: Object.freeze([from, ...inner, to]),
    knots: Object.freeze(knots),
    ...construction,
  });
}
