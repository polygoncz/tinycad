import { assertNever } from '@/core';
import type { Vec2 } from '@/core';
import { curvePoints } from './edit';
import { pointsById } from './points';
import { circularStep, isPattern, isPatternSource } from './model';
import type {
  SketchCircularPattern,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchLinearPattern,
  SketchMirror,
  SketchPattern,
  SketchPoint,
} from './model';

// Copies of mirrors and patterns (spec 12 "Zrcadlení a pole (M36)"). A pattern is a recipe; its
// copies are derived here from the solved originals and never enter the solver. A copy has the
// derived id '<pattern>:<index>.<source>', stable while only spacing, angle or geometry change.

/** The index part of a derived id: i or i-j, then a dot and a non-empty id without : and ,. */
const COPY_SUFFIX = /^\d+(?:-\d+)?\.[^:,]+$/;

type Copy = SketchPoint | SketchCurve;

/** One instance of a pattern other than the original: its index and how it moves a point. */
interface Instance {
  readonly index: string;
  readonly map: (p: Vec2) => Vec2;
  /** A reflection: arcs swap start and end to stay counter-clockwise. */
  readonly mirrored: boolean;
}

/**
 * Copies of all patterns of the sketch as plain entities (points and curves) with derived ids;
 * the original (index 0) is not copied. Order: patterns in entity order, instances ascending,
 * sources in the order of `sources`, points before their curve, every id once.
 */
export function patternCopies(data: SketchData): readonly Copy[] {
  const entities = new Map<SketchEntityId, SketchEntity>(data.entities.map((e) => [e.id, e]));
  const points = pointsById(data);
  const copies: Copy[] = [];
  for (const pattern of data.entities.filter(isPattern)) {
    for (const instance of instances(pattern, entities, points)) {
      const done = new Set<SketchEntityId>();
      const derived = (id: SketchEntityId) => derivedId(pattern.id, instance.index, id);
      const copyPoint = (id: SketchEntityId): void => {
        const p = points.get(id);
        const copyId = derived(id);
        if (p === undefined || done.has(copyId)) return;
        done.add(copyId);
        const [x, y] = instance.map([p.x, p.y]);
        copies.push(Object.freeze({ kind: 'point', id: copyId, x, y }));
      };
      for (const sourceId of pattern.sources) {
        const source = entities.get(sourceId);
        // parseSketchData guarantees a point or a curve; anything else has no copy.
        if (source === undefined || !isPatternSource(source)) continue;
        if (source.kind === 'point') {
          copyPoint(source.id);
          continue;
        }
        curvePoints(source).forEach(copyPoint);
        const copyId = derived(source.id);
        if (done.has(copyId)) continue;
        done.add(copyId);
        copies.push(Object.freeze(copyCurve(source, copyId, derived, instance)));
      }
    }
  }
  return Object.freeze(copies);
}

/**
 * The id of the pattern entity from the derived id of a copy ('<pattern>:<index>.<source>'), else
 * null.
 */
export function patternOfCopy(id: string): SketchEntityId | null {
  const colon = id.indexOf(':');
  if (colon <= 0) return null;
  const pattern = id.slice(0, colon);
  if (pattern.includes(',') || !COPY_SUFFIX.test(id.slice(colon + 1))) return null;
  // The prefix of a derived id is the id of its pattern entity (patternCopies builds it so).
  return pattern as SketchEntityId;
}

function derivedId(pattern: SketchEntityId, index: string, source: SketchEntityId): SketchEntityId {
  // A derived id is an entity id by the contract of spec 12 ("Křivky pro oblasti a odvozená id").
  return `${pattern}:${index}.${source}` as SketchEntityId;
}

/** The copy of a curve: its points by derived ids, coordinates it stores moved, construction kept. */
function copyCurve(
  c: SketchCurve,
  id: SketchEntityId,
  derived: (id: SketchEntityId) => SketchEntityId,
  instance: Instance,
): SketchCurve {
  const construction = c.construction === true ? { construction: true as const } : {};
  switch (c.kind) {
    case 'line':
      return { kind: c.kind, id, p1: derived(c.p1), p2: derived(c.p2), ...construction };
    case 'circle':
      return { kind: c.kind, id, center: derived(c.center), radius: c.radius, ...construction };
    case 'arc': {
      // A reflection turns the arc clockwise; swapping its ends keeps it counter-clockwise.
      const [start, end] = instance.mirrored ? [c.end, c.start] : [c.start, c.end];
      return {
        kind: c.kind,
        id,
        center: derived(c.center),
        start: derived(start),
        end: derived(end),
        ...construction,
      };
    }
    case 'bspline':
      return {
        kind: c.kind,
        id,
        degree: c.degree,
        poles: Object.freeze(c.poles.map(derived)),
        knots: c.knots,
        ...construction,
      };
    case 'fitSpline':
      return {
        kind: c.kind,
        id,
        degree: c.degree,
        fit: Object.freeze(c.fit.map(derived)),
        params: c.params,
        poles: Object.freeze(c.poles.map((p) => Object.freeze(instance.map(p)))),
        knots: c.knots,
        ...construction,
      };
    case 'xline':
      // An xline (M31) is always construction; its copy too.
      return { kind: c.kind, id, p1: derived(c.p1), p2: derived(c.p2), construction: true };
    default:
      return assertNever(c);
  }
}

/** The instances of a pattern without the original, in ascending index order. */
function instances(
  pattern: SketchPattern,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): readonly Instance[] {
  switch (pattern.kind) {
    case 'mirror':
      return mirrorInstances(pattern, entities, points);
    case 'linearPattern':
      return linearInstances(pattern);
    case 'circularPattern':
      return circularInstances(pattern, points);
    default:
      return assertNever(pattern);
  }
}

function mirrorInstances(
  pattern: SketchMirror,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): readonly Instance[] {
  const axis = axisPoints(pattern.axis, entities, points);
  if (axis === undefined) return [];
  const [o, u] = axis;
  const dx = u[0] - o[0];
  const dy = u[1] - o[1];
  const length = Math.hypot(dx, dy);
  // A zero-length axis defines no line to mirror across: no copy rather than NaN coordinates.
  if (length === 0) return [];
  const d: Vec2 = [dx / length, dy / length];
  const map = ([x, y]: Vec2): Vec2 => {
    // p' = o + 2·((p − o)·d)·d − (p − o)
    const vx = x - o[0];
    const vy = y - o[1];
    const along = vx * d[0] + vy * d[1];
    return [o[0] + 2 * along * d[0] - vx, o[1] + 2 * along * d[1] - vy];
  };
  return [{ index: '1', map, mirrored: true }];
}

/** The coordinates of the two points of the axis line, or undefined when it is not a line of the sketch. */
function axisPoints(
  axis: SketchEntityId,
  entities: ReadonlyMap<SketchEntityId, SketchEntity>,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): readonly [Vec2, Vec2] | undefined {
  const line = entities.get(axis);
  if (line?.kind !== 'line') return undefined;
  const p1 = points.get(line.p1);
  const p2 = points.get(line.p2);
  if (p1 === undefined || p2 === undefined) return undefined;
  return [
    [p1.x, p1.y],
    [p2.x, p2.y],
  ];
}

function linearInstances(pattern: SketchLinearPattern): readonly Instance[] {
  const { direction1, direction2 } = pattern;
  const step1: Vec2 = [
    direction1.spacing * Math.cos(direction1.angle),
    direction1.spacing * Math.sin(direction1.angle),
  ];
  const translate =
    (i: number, j: number, step2: Vec2) =>
    ([x, y]: Vec2): Vec2 => [x + i * step1[0] + j * step2[0], y + i * step1[1] + j * step2[1]];
  const out: Instance[] = [];
  if (direction2 === undefined) {
    for (let i = 1; i < direction1.count; i++) {
      out.push({ index: String(i), map: translate(i, 0, [0, 0]), mirrored: false });
    }
    return out;
  }
  const step2: Vec2 = [
    direction2.spacing * Math.cos(direction2.angle),
    direction2.spacing * Math.sin(direction2.angle),
  ];
  for (let i = 0; i < direction1.count; i++) {
    for (let j = 0; j < direction2.count; j++) {
      if (i === 0 && j === 0) continue;
      out.push({
        index: `${String(i)}-${String(j)}`,
        map: translate(i, j, step2),
        mirrored: false,
      });
    }
  }
  return out;
}

function circularInstances(
  pattern: SketchCircularPattern,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): readonly Instance[] {
  const center = points.get(pattern.center);
  if (center === undefined) return [];
  const step = circularStep(pattern);
  const out: Instance[] = [];
  for (let k = 1; k < pattern.count; k++) {
    const cos = Math.cos(k * step);
    const sin = Math.sin(k * step);
    const map = ([x, y]: Vec2): Vec2 => {
      const vx = x - center.x;
      const vy = y - center.y;
      return [center.x + cos * vx - sin * vy, center.y + sin * vx + cos * vy];
    };
    out.push({ index: String(k), map, mirrored: false });
  }
  return out;
}
