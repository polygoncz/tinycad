import { assert, bspline, type Vec2 } from '@/core';
import { curve2, pointsById } from './geometry';
import type { Curve2 } from './geometry';
import type { SketchCurve, SketchData, SketchEntity } from './model';

// Closed regions (profiles) of a sketch as a planar graph (spec 12 "Oblasti (profily)").
// Pure 2D geometry, testable without OCCT: curves → nodes → crossing check → pruning of open
// chains → faces by half-edges → holes → names from curve ids. Splines (M29) are edges between
// their end poles; crossings, areas and containment use their tessellation (spec 12 "Spliny").

export interface SketchRegion {
  /** Ids of all boundary curves (outer and holes), without duplicates, sorted (string comparison), joined by ','. */
  readonly name: string;
  /** A closed counter-clockwise loop. */
  readonly outer: readonly Curve2[];
  /** Closed clockwise loops. */
  readonly holes: readonly (readonly Curve2[])[];
  /** > 0: outer minus holes. */
  readonly area: number;
}

export interface RegionsResult {
  readonly regions: readonly SketchRegion[];
  readonly crossing: boolean;
}

/** Outgoing directions closer than this (radians) are a tie, broken by curvature (spec 12). */
const ANGLE_TIE = 1e-9;
/**
 * Intersection points computed near a shared node are matched to it with this many `tol`: near
 * tangencies lose precision in the intersection formulas, the node itself does not.
 */
const NODE_MATCH_FACTOR = 1e3;
/** Direction of the containment ray: irrational, so it practically never hits a vertex exactly. */
const RAY: Vec2 = normalize([Math.SQRT2, Math.PI]);
const TWO_PI = 2 * Math.PI;
/**
 * Spline tessellation tolerance relative to the sketch scale (spec 12 "Spliny (M29)"); the sketcher
 * draws splines with the same tolerance.
 */
export const SPLINE_TOLERANCE = 1e-4;

/**
 * A curve of a loop with the tessellation of a spline in the same direction (`poly`, only for
 * splines): crossings, areas and containment of a spline are computed on it.
 */
interface Part {
  readonly curve: Curve2;
  readonly poly?: readonly Vec2[];
}

/**
 * A line, an arc or a spline between two nodes; arcs are counter-clockwise from `from` to `to`.
 * A closed spline is a loop at one node (`from === to`).
 */
interface Edge extends Part {
  readonly id: string;
  readonly curve: Extract<Curve2, { kind: 'line' | 'arc' | 'bspline' }>;
  readonly from: number;
  readonly to: number;
}

/** A curve for the crossing check: an edge with its nodes, or a lone circle. */
type Shape =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2; readonly nodes: readonly number[] }
  | {
      readonly kind: 'polyline';
      readonly points: readonly Vec2[];
      readonly nodes: readonly number[];
    }
  | {
      readonly kind: 'arc';
      readonly c: Vec2;
      readonly r: number;
      readonly start: number;
      readonly sweep: number;
      readonly ends: readonly [Vec2, Vec2];
      readonly nodes: readonly number[];
    }
  | {
      readonly kind: 'circle';
      readonly c: Vec2;
      readonly r: number;
      readonly nodes: readonly number[];
    };

/** One traversal direction of an edge. Half-edge h belongs to edge h >> 1; its twin is h ^ 1. */
interface HalfEdge extends Part {
  readonly origin: number;
  readonly dest: number;
  readonly angle: number;
  readonly curvature: number;
}

/** A closed loop with its curve ids and signed area. */
interface Loop {
  readonly parts: readonly Part[];
  readonly ids: readonly string[];
  readonly area: number;
  readonly component: number;
}

export function computeRegions(data: SketchData): RegionsResult {
  const points = pointsById(data);
  const scale = Math.max(1, ...[...points.values()].flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  const tol = 1e-9 * scale;
  const splineTol = SPLINE_TOLERANCE * scale;

  // 1. Curves: non-construction only, degenerate ones skipped.
  const nodes: Vec2[] = [];
  const nodeAt = (p: Vec2): number => {
    const found = nodes.findIndex((n) => dist(n, p) <= tol);
    if (found !== -1) return found;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  const circles: { readonly id: string; readonly curve: Extract<Curve2, { kind: 'circle' }> }[] =
    [];
  for (const e of data.entities) {
    if (!isCurve(e) || e.construction === true) continue;
    const curve = curve2(e, points);
    if (curve.kind === 'circle') {
      circles.push({ id: e.id, curve });
      continue;
    }
    if (curve.kind === 'bspline') {
      const poly = bspline.tessellate(curve, splineTol);
      const first = poly[0];
      const last = poly[poly.length - 1];
      // A spline of zero length is skipped like a zero-length line.
      if (first === undefined || last === undefined || poly.every((p) => dist(p, first) <= tol)) {
        continue;
      }
      // 2. Nodes: a spline with both ends in one node is a closed loop at that node.
      edges.push({ id: e.id, curve, poly, from: nodeAt(first), to: nodeAt(last) });
      continue;
    }
    if (dist(curve.from, curve.to) <= tol) continue;
    // 2. Nodes: ends closer than tol are one node.
    const from = nodeAt(curve.from);
    const to = nodeAt(curve.to);
    if (from !== to) edges.push({ id: e.id, curve, from, to });
  }

  // 3. Crossing: a common point other than a shared end node.
  const shapes: Shape[] = [
    ...edges.map((e) => shapeOf(e)),
    ...circles.map((c): Shape => ({
      kind: 'circle',
      c: c.curve.center,
      r: c.curve.radius,
      nodes: [],
    })),
  ];
  const nodeTol = NODE_MATCH_FACTOR * tol;
  for (const shape of shapes) {
    if (shape.kind === 'polyline' && crossesItself(shape, nodes, tol, nodeTol)) {
      return { regions: [], crossing: true };
    }
  }
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      if (a === undefined || b === undefined) continue;
      const contact = intersect(a, b, tol);
      if (contact === 'overlap') return { regions: [], crossing: true };
      const shared = a.nodes.filter((n) => b.nodes.includes(n));
      const atSharedNode = (p: Vec2) =>
        shared.some((n) => {
          const node = nodes[n];
          return node !== undefined && dist(node, p) <= nodeTol;
        });
      if (!contact.every(atSharedNode)) return { regions: [], crossing: true };
    }
  }

  // 4. Pruning: open chains bound nothing.
  const alive = prune(edges, nodes.length);

  // 5. Faces by half-edges.
  const component = components(alive, nodes.length);
  const loops = traceLoops(alive, nodes.length).map((cycle): Loop => {
    const first = cycle[0];
    return {
      parts: cycle,
      ids: cycle.map((h) => h.id),
      area: cycle.reduce((sum, h) => sum + signedArea(h), 0),
      component: first === undefined ? -1 : (component[first.origin] ?? -1),
    };
  });
  const faces = loops.filter((l) => l.area > 0);
  const boundaries = loops.filter((l) => l.area < 0);
  // A lone circle is its own component: one bounded face and its outer boundary.
  circles.forEach((c, i) => {
    const area = Math.PI * c.curve.radius ** 2;
    const loop = { parts: [{ curve: c.curve }], ids: [c.id], component: nodes.length + i };
    faces.push({ ...loop, area });
    boundaries.push({ ...loop, area: -area });
  });

  // 6. Holes: each outer boundary goes to the smallest face of another component containing it.
  const holes = new Map<Loop, Loop[]>(faces.map((f) => [f, []]));
  for (const boundary of boundaries) {
    const sample = samplePoint(boundary.parts);
    let best: Loop | undefined;
    for (const face of faces) {
      if (face.component === boundary.component) continue;
      if (!contains(face.parts, sample)) continue;
      if (best === undefined || face.area < best.area) best = face;
    }
    if (best !== undefined) holes.get(best)?.push(boundary);
  }

  // 7. Names from curve ids.
  const regions = faces.map((face): SketchRegion => {
    const faceHoles = holes.get(face) ?? [];
    const ids = new Set([face.ids, ...faceHoles.map((h) => h.ids)].flat());
    return Object.freeze({
      name: [...ids].sort(compareStrings).join(','),
      outer: curvesOf(face),
      holes: Object.freeze(faceHoles.map(curvesOf)),
      area: faceHoles.reduce((sum, h) => sum + h.area, face.area),
    });
  });
  regions.sort((a, b) => compareStrings(a.name, b.name));
  return Object.freeze({ regions: Object.freeze(regions), crossing: false });
}

function isCurve(e: SketchEntity): e is SketchCurve {
  return e.kind !== 'point';
}

function curvesOf(loop: Loop): readonly Curve2[] {
  return Object.freeze(loop.parts.map((p) => p.curve));
}

function shapeOf(e: Edge): Shape {
  const nodes = [e.from, e.to];
  const { curve } = e;
  if (curve.kind === 'line') return { kind: 'line', a: curve.from, b: curve.to, nodes };
  if (curve.kind === 'bspline') return { kind: 'polyline', points: polyOf(e), nodes };
  const r = dist(curve.center, curve.from);
  const start = angleOf(sub(curve.from, curve.center));
  const sweep = mod2pi(angleOf(sub(curve.to, curve.center)) - start);
  return { kind: 'arc', c: curve.center, r, start, sweep, ends: [curve.from, curve.to], nodes };
}

/** Removes edges at nodes of degree 1 until there are none; returns the surviving edges. */
function prune(edges: readonly Edge[], nodeCount: number): readonly Edge[] {
  const degree = new Array<number>(nodeCount).fill(0);
  for (const e of edges) {
    degree[e.from] = (degree[e.from] ?? 0) + 1;
    degree[e.to] = (degree[e.to] ?? 0) + 1;
  }
  const alive = new Set(edges);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of alive) {
      if (degree[e.from] === 1 || degree[e.to] === 1) {
        alive.delete(e);
        degree[e.from] = (degree[e.from] ?? 0) - 1;
        degree[e.to] = (degree[e.to] ?? 0) - 1;
        changed = true;
      }
    }
  }
  return edges.filter((e) => alive.has(e));
}

/** Connected component of every node (union-find over the edges). */
function components(edges: readonly Edge[], nodeCount: number): readonly number[] {
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  for (const e of edges) parent[find(e.from)] = find(e.to);
  return parent.map((_, i) => find(i));
}

/**
 * All face cycles of the graph. Outgoing half-edges are sorted counter-clockwise around each node
 * by tangent angle, a tie by signed curvature (the one turning more left is further). next(e) is
 * the outgoing half-edge at e's destination right clockwise of twin(e): the face is on the left.
 */
function traceLoops(
  edges: readonly Edge[],
  nodeCount: number,
): readonly (readonly (HalfEdge & { readonly id: string })[])[] {
  const halves = edges.flatMap((e) => halfEdges(e).map((h) => ({ ...h, id: e.id })));
  const outgoing: number[][] = Array.from({ length: nodeCount }, () => []);
  halves.forEach((h, i) => outgoing[h.origin]?.push(i));
  const position = new Array<number>(halves.length).fill(0);
  for (const list of outgoing) {
    list.sort((i, j) => compareOutgoing(halves[i], halves[j]));
    list.forEach((h, k) => (position[h] = k));
  }
  const next = (i: number): number => {
    const h = halves[i];
    const twin = i ^ 1;
    const list = h === undefined ? undefined : outgoing[h.dest];
    if (list === undefined) return -1;
    const k = position[twin] ?? 0;
    return list[(k - 1 + list.length) % list.length] ?? -1;
  };

  const visited = new Array<boolean>(halves.length).fill(false);
  const cycles: (HalfEdge & { readonly id: string })[][] = [];
  for (let startIndex = 0; startIndex < halves.length; startIndex++) {
    if (visited[startIndex] === true) continue;
    const cycle: (HalfEdge & { readonly id: string })[] = [];
    let i = startIndex;
    // Every half-edge is on exactly one cycle; the bound only guards against a broken order.
    for (let steps = 0; steps <= halves.length && i !== -1 && visited[i] !== true; steps++) {
      visited[i] = true;
      const h = halves[i];
      if (h !== undefined) cycle.push(h);
      i = next(i);
    }
    cycles.push(cycle);
  }
  return cycles;
}

function compareOutgoing(a: HalfEdge | undefined, b: HalfEdge | undefined): number {
  if (a === undefined || b === undefined) return 0;
  if (Math.abs(a.angle - b.angle) > ANGLE_TIE) return a.angle - b.angle;
  return a.curvature - b.curvature;
}

/** Forward (from → to) and reverse half-edges of an edge, in this order; both keep the entity id (M14). */
function halfEdges(e: Edge): readonly [HalfEdge, HalfEdge] {
  const { curve } = e;
  if (curve.kind === 'bspline') return splineHalfEdges(e, curve, polyOf(e));
  if (curve.kind === 'line') {
    const d = sub(curve.to, curve.from);
    return [
      { origin: e.from, dest: e.to, angle: direction(d), curvature: 0, curve },
      {
        origin: e.to,
        dest: e.from,
        angle: direction([-d[0], -d[1]]),
        curvature: 0,
        curve: { kind: 'line', from: curve.to, to: curve.from, id: e.id },
      },
    ];
  }
  const r = dist(curve.center, curve.from);
  const s = sub(curve.from, curve.center);
  const t = sub(curve.to, curve.center);
  return [
    // Counter-clockwise: the tangent is the radius turned left; turning left, curvature +1/r.
    { origin: e.from, dest: e.to, angle: direction([-s[1], s[0]]), curvature: 1 / r, curve },
    {
      origin: e.to,
      dest: e.from,
      angle: direction([t[1], -t[0]]),
      curvature: -1 / r,
      curve: {
        kind: 'arc',
        center: curve.center,
        from: curve.to,
        to: curve.from,
        ccw: false,
        id: e.id,
      },
    },
  ];
}

/**
 * Half-edges of a spline: the tangent from the first derivative at the end leaving the node (−r'(1)
 * at the far end), the signed curvature κ = (x'y'' − y'x'') / |r'|³ from the first and second
 * derivatives; reversing the direction flips the sign of κ.
 */
function splineHalfEdges(
  e: Edge,
  curve: Extract<Curve2, { kind: 'bspline' }>,
  poly: readonly Vec2[],
): readonly [HalfEdge, HalfEdge] {
  const d0 = bspline.derivative(curve, 0, 1);
  const d1 = bspline.derivative(curve, 1, 1);
  const back: Vec2 = [-d1[0], -d1[1]];
  const reversedPoly = [...poly].reverse();
  return [
    {
      origin: e.from,
      dest: e.to,
      angle: direction(tangentOr(d0, poly)),
      curvature: curvature(d0, bspline.derivative(curve, 0, 2)),
      curve,
      poly,
    },
    {
      origin: e.to,
      dest: e.from,
      angle: direction(tangentOr(back, reversedPoly)),
      curvature: -curvature(d1, bspline.derivative(curve, 1, 2)),
      curve: reverseSpline(curve, e.id),
      poly: reversedPoly,
    },
  ];
}

/** The derivative, or the first chord of the tessellation where the derivative vanishes. */
function tangentOr(d: Vec2, poly: readonly Vec2[]): Vec2 {
  if (d[0] !== 0 || d[1] !== 0) return d;
  const [a, b] = poly;
  return a === undefined || b === undefined ? d : sub(b, a);
}

/** Signed curvature from the first and second derivative; 0 where the first one vanishes. */
function curvature(d1: Vec2, d2: Vec2): number {
  const speed = length(d1);
  return speed === 0 ? 0 : cross(d1, d2) / speed ** 3;
}

/** The same spline traversed backwards: poles reversed, knots mirrored (k → 1 − k, reversed). */
function reverseSpline(
  curve: Extract<Curve2, { kind: 'bspline' }>,
  id: string,
): Extract<Curve2, { kind: 'bspline' }> {
  return {
    kind: 'bspline',
    degree: curve.degree,
    poles: [...curve.poles].reverse(),
    knots: curve.knots.map((k) => 1 - k).reverse(),
    id,
  };
}

/** Angle in [0, 2π); a value within the tie tolerance of 2π becomes 0, so ties do not split at the wrap. */
function direction(d: Vec2): number {
  const a = mod2pi(angleOf(d));
  return TWO_PI - a <= ANGLE_TIE ? 0 : a;
}

/**
 * The shoelace term of a curve plus the circular segment of an arc (+ counter-clockwise,
 * − clockwise); a spline sums the shoelace terms of its tessellation.
 */
function signedArea({ curve: c, poly }: Part): number {
  if (c.kind === 'circle') return Math.PI * c.radius ** 2;
  if (c.kind === 'bspline') {
    let sum = 0;
    for (let i = 1; i < (poly?.length ?? 0); i++) {
      const p = poly?.[i - 1];
      const q = poly?.[i];
      if (p !== undefined && q !== undefined) sum += cross(p, q);
    }
    return sum / 2;
  }
  const chord = (c.from[0] * c.to[1] - c.to[0] * c.from[1]) / 2;
  if (c.kind === 'line') return chord;
  const r = dist(c.center, c.from);
  const a0 = angleOf(sub(c.from, c.center));
  const a1 = angleOf(sub(c.to, c.center));
  const sweep = c.ccw ? mod2pi(a1 - a0) : mod2pi(a0 - a1);
  const segment = (r * r * (sweep - Math.sin(sweep))) / 2;
  return chord + (c.ccw ? segment : -segment);
}

function samplePoint(loop: readonly Part[]): Vec2 {
  const first = loop[0]?.curve;
  if (first === undefined) return [Number.NaN, Number.NaN];
  if (first.kind === 'circle') return [first.center[0] + first.radius, first.center[1]];
  if (first.kind === 'bspline') return first.poles[0] ?? [Number.NaN, Number.NaN];
  return first.from;
}

/** Point in a closed loop by ray casting (the point is never on the loop: crossings are excluded). */
function contains(loop: readonly Part[], p: Vec2): boolean {
  let hits = 0;
  for (const { curve: c, poly } of loop) {
    if (c.kind === 'circle') return dist(c.center, p) < c.radius;
    if (c.kind === 'line') {
      if (rayHitsSegment(p, c.from, c.to)) hits++;
      continue;
    }
    if (c.kind === 'bspline') {
      for (let i = 1; i < (poly?.length ?? 0); i++) {
        const a = poly?.[i - 1];
        const b = poly?.[i];
        if (a !== undefined && b !== undefined && rayHitsSegment(p, a, b)) hits++;
      }
      continue;
    }
    const r = dist(c.center, c.from);
    const a0 = angleOf(sub(c.ccw ? c.from : c.to, c.center));
    const a1 = angleOf(sub(c.ccw ? c.to : c.from, c.center));
    const sweep = mod2pi(a1 - a0);
    const w = sub(p, c.center);
    const b = dot(RAY, w);
    const disc = b * b - (dot(w, w) - r * r);
    if (disc <= 0) continue;
    for (const t of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
      if (t <= 0) continue;
      const q: Vec2 = [p[0] + RAY[0] * t, p[1] + RAY[1] * t];
      if (mod2pi(angleOf(sub(q, c.center)) - a0) <= sweep) hits++;
    }
  }
  return hits % 2 === 1;
}

/** The containment ray from p crosses segment a b (half-open at b, so a shared vertex counts once). */
function rayHitsSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const d = sub(b, a);
  const denom = cross(RAY, d);
  if (denom === 0) return false;
  const w = sub(a, p);
  const t = cross(w, d) / denom;
  const s = cross(w, RAY) / denom;
  return t > 0 && s >= 0 && s < 1;
}

// --- Intersections for the crossing check ---------------------------------------------------

/** Common points of two shapes, or 'overlap' when they share a piece of positive length. */
function intersect(a: Shape, b: Shape, tol: number): readonly Vec2[] | 'overlap' {
  // A spline meets other curves through the segments of its tessellation.
  if (a.kind === 'polyline') return intersectSegments(segmentsOf(a), b, tol, false);
  if (b.kind === 'polyline') return intersectSegments(segmentsOf(b), a, tol, true);
  if (a.kind === 'line') {
    return b.kind === 'line' ? lineLine(a.a, a.b, b.a, b.b, tol) : lineRound(a, roundOf(b), tol);
  }
  if (b.kind === 'line') return lineRound(b, roundOf(a), tol);
  return roundRound(roundOf(a), roundOf(b), tol);
}

function intersectSegments(
  segments: readonly Extract<Shape, { kind: 'line' }>[],
  other: Shape,
  tol: number,
  swapped: boolean,
): readonly Vec2[] | 'overlap' {
  const points: Vec2[] = [];
  for (const segment of segments) {
    const contact = swapped ? intersect(other, segment, tol) : intersect(segment, other, tol);
    if (contact === 'overlap') return contact;
    points.push(...contact);
  }
  return points;
}

/**
 * A spline crosses itself (spec 12 "Spliny (M29)", Q087): adjacent tessellation segments may only
 * share their common point (an overlap is a crossing), non-adjacent ones must not meet at all –
 * except the first and the last segment of a closed spline, which meet in its node.
 */
function crossesItself(
  s: Extract<Shape, { kind: 'polyline' }>,
  nodes: readonly Vec2[],
  tol: number,
  nodeTol: number,
): boolean {
  const segments = segmentsOf(s);
  const [from, to] = s.nodes;
  const node = from !== undefined && from === to ? nodes[from] : undefined;
  const last = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (a === undefined || b === undefined) continue;
      const contact = lineLine(a.a, a.b, b.a, b.b, tol);
      if (contact === 'overlap') return true;
      if (j === i + 1) continue;
      const closing = node !== undefined && i === 0 && j === last;
      if (!contact.every((p) => closing && dist(node, p) <= nodeTol)) return true;
    }
  }
  return false;
}

/** The tessellation segments of a spline, each with the spline's end nodes. */
function segmentsOf(s: Extract<Shape, { kind: 'polyline' }>): Extract<Shape, { kind: 'line' }>[] {
  const segments: Extract<Shape, { kind: 'line' }>[] = [];
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    // Coinciding tessellation points would make a zero-length segment without a direction.
    if (a !== undefined && b !== undefined && dist(a, b) > 0) {
      segments.push({ kind: 'line', a, b, nodes: s.nodes });
    }
  }
  return segments;
}

/** A circle or an arc as center, radius and angular range (a circle covers the full turn). */
interface Round {
  readonly c: Vec2;
  readonly r: number;
  readonly start: number;
  readonly sweep: number;
  readonly full: boolean;
  readonly ends: readonly Vec2[];
}

function roundOf(s: Extract<Shape, { kind: 'arc' | 'circle' }>): Round {
  return s.kind === 'circle'
    ? { c: s.c, r: s.r, start: 0, sweep: TWO_PI, full: true, ends: [] }
    : { c: s.c, r: s.r, start: s.start, sweep: s.sweep, full: false, ends: s.ends };
}

function lineLine(
  a0: Vec2,
  a1: Vec2,
  b0: Vec2,
  b1: Vec2,
  tol: number,
): readonly Vec2[] | 'overlap' {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const len1 = length(d1);
  const len2 = length(d2);
  const denom = cross(d1, d2);
  const w = sub(b0, a0);
  if (Math.abs(denom) <= 1e-12 * len1 * len2) {
    // Parallel: only collinear lines can meet.
    if (Math.abs(cross(w, d1)) / len1 > tol) return [];
    const tb0 = dot(w, d1) / (len1 * len1);
    const tb1 = dot(sub(b1, a0), d1) / (len1 * len1);
    const lo = Math.max(0, Math.min(tb0, tb1));
    const hi = Math.min(1, Math.max(tb0, tb1));
    if ((hi - lo) * len1 > tol) return 'overlap';
    if ((lo - hi) * len1 > tol) return [];
    return [lerp(a0, d1, (lo + hi) / 2)];
  }
  const t = cross(w, d2) / denom;
  const u = cross(w, d1) / denom;
  const e1 = tol / len1;
  const e2 = tol / len2;
  return t >= -e1 && t <= 1 + e1 && u >= -e2 && u <= 1 + e2 ? [lerp(a0, d1, t)] : [];
}

function lineRound(
  line: Extract<Shape, { kind: 'line' }>,
  round: Round,
  tol: number,
): readonly Vec2[] {
  const d = sub(line.b, line.a);
  const len = length(d);
  const t0 = dot(sub(round.c, line.a), d) / (len * len);
  const foot = lerp(line.a, d, t0);
  const h2 = round.r * round.r - dot(sub(round.c, foot), sub(round.c, foot));
  const gap = dist(round.c, foot) - round.r;
  let params: number[];
  if (Math.abs(gap) <= tol) params = [t0];
  else if (gap > 0) return [];
  else {
    const h = Math.sqrt(Math.max(0, h2)) / len;
    params = [t0 - h, t0 + h];
  }
  const e = tol / len;
  return params
    .filter((t) => t >= -e && t <= 1 + e)
    .map((t) => lerp(line.a, d, t))
    .filter((p) => onRound(round, p, tol));
}

function roundRound(a: Round, b: Round, tol: number): readonly Vec2[] | 'overlap' {
  const d = dist(a.c, b.c);
  if (d <= tol) {
    if (Math.abs(a.r - b.r) > tol) return [];
    // The same circle: any shared piece is an overlap; arcs may only touch at their ends.
    if (a.full || b.full || arcsOverlap(a, b, tol)) return 'overlap';
    return [
      ...a.ends.filter((p) => onRound(b, p, tol)),
      ...b.ends.filter((p) => onRound(a, p, tol)),
    ];
  }
  if (d > a.r + b.r + tol || d < Math.abs(a.r - b.r) - tol) return [];
  const u: Vec2 = [(b.c[0] - a.c[0]) / d, (b.c[1] - a.c[1]) / d];
  // Distance from a.c along u to the chord of the intersection points.
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const tangent = Math.abs(d - (a.r + b.r)) <= tol || Math.abs(d - Math.abs(a.r - b.r)) <= tol;
  const candidates: Vec2[] = tangent
    ? [lerp(a.c, u, Math.sign(along) * a.r)]
    : (() => {
        const h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
        const m = lerp(a.c, u, along);
        return [
          [m[0] - u[1] * h, m[1] + u[0] * h],
          [m[0] + u[1] * h, m[1] - u[0] * h],
        ];
      })();
  return candidates.filter((p) => onRound(a, p, tol) && onRound(b, p, tol));
}

/** Two arcs of the same circle share a piece: one starts strictly inside the other, or both start together. */
function arcsOverlap(a: Round, b: Round, tol: number): boolean {
  const eps = tol / a.r;
  const strictlyInside = (angle: number, arc: Round) => {
    const diff = mod2pi(angle - arc.start);
    return diff > eps && diff < arc.sweep - eps;
  };
  const startDiff = mod2pi(a.start - b.start);
  const sameStart = startDiff <= eps || TWO_PI - startDiff <= eps;
  return sameStart || strictlyInside(a.start, b) || strictlyInside(b.start, a);
}

/** The point (already on the circle) lies within the arc's angular range, with tolerance. */
function onRound(round: Round, p: Vec2, tol: number): boolean {
  if (round.full) return true;
  const eps = tol / round.r;
  const diff = mod2pi(angleOf(sub(p, round.c)) - round.start);
  return diff <= round.sweep + eps || diff >= TWO_PI - eps;
}

// --- 2D vector helpers -----------------------------------------------------------------------

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

function length(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lerp(origin: Vec2, d: Vec2, t: number): Vec2 {
  return [origin[0] + d[0] * t, origin[1] + d[1] * t];
}

function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return [a[0] / l, a[1] / l];
}

function angleOf(d: Vec2): number {
  return Math.atan2(d[1], d[0]);
}

function mod2pi(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** Plain string comparison by UTF-16 code units (spec 12: names sorted by string comparison). */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The tessellation of a spline part; every spline part carries one (a missing one is a bug). */
function polyOf(part: Part): readonly Vec2[] {
  assert(part.poly !== undefined, 'regions: a spline part without its tessellation');
  return part.poly;
}
