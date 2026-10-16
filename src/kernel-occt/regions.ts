import type { Geom2d_Curve, gp_Pnt2d, gp_Vec2d } from 'replicad-opencascadejs';
import type { Vec2 } from '@/core';
import type { IdentifiedCurve, ProfileCurve, ProfileRegion, ProfileRegions } from '@/kernel';
import { compressKnots } from './face';
import type { Occt } from './occt';

// profileRegions of the OCCT adapter (spec 06 "Stav po M30", spec 12 "Oblasti (profily)"; M30
// task 2, way b of the prototype): the contract algorithm of the FakeKernel, with the geometry
// from OCCT. Curves become Geom2d curves; crossings come from Geom2dAPI_InterCurveCurve over the
// pairs whose bounding boxes overlap (and a spline against itself); tangents and curvatures at
// the nodes from the derivatives of the curves; signed areas by Green's theorem (Gauss–Legendre
// over the first derivative); containment of a hole by the parity of a ray, intersected by
// Geom2dAPI_InterCurveCurve too. The loops of the result are built from the input curves, not
// read back from OCCT. Internal to kernel-occt; the input is already checked by
// parseProfileRegionsInput.

/** Precision::Confusion: the tolerance of intersections and of nodes, times the scale. */
const CONFUSION = 1e-7;
/**
 * Intersection points within this many `tol` of a shared node are matched to it (spec 12
 * "Oblasti (profily)" step 3): near tangencies lose precision, the node itself does not.
 */
const NODE_MATCH_FACTOR = 1e3;
/** Outgoing directions closer than this (radians) are a tie, broken by curvature (spec 12). */
const ANGLE_TIE = 1e-9;
/** Nodes and weights of the 5-point Gauss–Legendre rule on [−1, 1]: exact up to degree 9. */
const GAUSS_LEGENDRE: readonly (readonly [number, number])[] = [
  [-0.906179845938664, 0.2369268850561891],
  [-0.5384693101056831, 0.4786286704993665],
  [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665],
  [0.906179845938664, 0.2369268850561891],
];
/** Pieces of the Green integral per full turn of a circle or an arc. */
const PIECES_PER_TURN = 16;
/**
 * The polynomial degree of a spline the rule integrates exactly in one knot span: x·y' − y·x'
 * of degree p has degree 2p − 1 ≤ 9. A span of a higher degree is split further.
 */
const EXACT_SPLINE_DEGREE = 5;
/** First direction of the containment ray: irrational, so it rarely meets a node. */
const RAY_ANGLE = Math.atan2(Math.PI, Math.SQRT2);
/** Next directions after a degenerate ray: the golden angle keeps them far from each other. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Directions tried before the last count is taken as it is. */
const RAY_ATTEMPTS = 8;
/** A ray meeting a curve at an angle with a smaller sine only touches it: try another ray. */
const GRAZING_SINE = 1e-3;
/** Inward step (part of the parameter range) to a tangent where the derivative vanishes. */
const TANGENT_STEP = 1e-3;

type Bounded = Extract<IdentifiedCurve, { kind: 'line' | 'arc' | 'bspline' }>;
type Circle = Extract<IdentifiedCurve, { kind: 'circle' }>;

/** Axis-aligned box [minX, minY, maxX, maxY]. */
type Box = readonly [number, number, number, number];

/**
 * A line, an arc or a spline between two nodes, with its OCCT curve parametrised from `from` to
 * `to` (an arc counter-clockwise). A closed spline is a loop at one node (`from === to`).
 */
interface Edge {
  readonly curve: Bounded;
  readonly g: Geom2d_Curve;
  readonly from: number;
  readonly to: number;
  readonly box: Box;
  /** ∮ (x dy − y dx) / 2 along the curve from `from` to `to`. */
  readonly green: number;
}

interface LoneCircle {
  readonly curve: Circle;
  readonly g: Geom2d_Curve;
  readonly box: Box;
}

/** One traversal direction of an edge: half-edge 2e runs from → to, 2e + 1 back. */
interface HalfEdge {
  readonly edge: number;
  readonly forward: boolean;
  readonly origin: number;
  readonly dest: number;
  readonly angle: number;
  readonly curvature: number;
}

/** A closed loop: its half-edges (or a lone circle), signed area, component and box. */
interface Loop {
  readonly halves: readonly HalfEdge[];
  readonly circle?: LoneCircle;
  readonly area: number;
  readonly component: number;
  readonly box: Box;
}

/** What the steps share: the module, the curves and the tolerances of this call. */
interface Context {
  readonly oc: Occt;
  readonly tol: number;
  readonly nodeTol: number;
  readonly nodes: readonly Vec2[];
  readonly edges: readonly Edge[];
  /** Length of a containment ray: from any point of the curves out of all of them. */
  readonly rayLength: number;
}

const CROSSING: ProfileRegions = Object.freeze({ regions: Object.freeze([]), crossing: true });

/**
 * Regions bounded by `curves` (checked by parseProfileRegionsInput: ids present and unique, no
 * curve of zero length), sorted by name; a crossing gives no regions. Every OCCT object made
 * here is deleted before it returns.
 */
export function profileRegionsOf(oc: Occt, curves: readonly IdentifiedCurve[]): ProfileRegions {
  const scale = Math.max(1, ...curves.flatMap(coordinatesOf).map(Math.abs));
  const tol = CONFUSION * scale;
  const owned: Geom2d_Curve[] = [];
  try {
    // 1–2. Curves and nodes: ends closer than tol are one node.
    const nodes: Vec2[] = [];
    const nodeAt = (p: Vec2): number => {
      const found = nodes.findIndex((n) => dist(n, p) <= tol);
      if (found !== -1) return found;
      nodes.push(p);
      return nodes.length - 1;
    };
    const edges: Edge[] = [];
    const circles: LoneCircle[] = [];
    using p = new oc.gp_Pnt2d(0, 0);
    using v = new oc.gp_Vec2d(0, 0);
    for (const input of curves) {
      const curve = counterClockwise(input);
      if (curve.kind === 'circle') {
        const g = circleCurve(oc, curve);
        owned.push(g);
        circles.push({ curve, g, box: boxOf(curve, tol) });
        continue;
      }
      const from = nodeAt(startOf(curve));
      const to = nodeAt(endOf(curve));
      // Only a spline may close at one node; a line or an arc there has (nearly) zero length.
      if (from === to && curve.kind !== 'bspline') continue;
      const g = boundedCurve(oc, curve);
      owned.push(g);
      const green = greenOf(g, breaksOf(curve, g), p, v);
      edges.push({ curve, g, from, to, box: boxOf(curve, tol), green });
    }
    const ctx: Context = {
      oc,
      tol,
      nodeTol: NODE_MATCH_FACTOR * tol,
      nodes,
      edges,
      rayLength: 4 * scale + 1,
    };

    // 3. Crossing: a common point other than a shared end node.
    if (crosses(ctx, circles)) return CROSSING;

    // 4. Pruning: open chains bound nothing.
    const alive = prune(edges, nodes.length);

    // 5. Faces by half-edges; signed areas from the Green integrals of the edges.
    using q = new oc.gp_Vec2d(0, 0);
    const halves = alive.flatMap((e) => halfEdges(ctx, e, edges[e], p, v, q));
    const component = components(
      alive.map((e) => edges[e]),
      nodes.length,
    );
    const loops = traceLoops(halves, nodes.length).map((cycle): Loop => {
      const first = cycle[0];
      return {
        halves: cycle,
        area: cycle.reduce((sum, h) => sum + (h.forward ? 1 : -1) * edgeOf(ctx, h).green, 0),
        component: first === undefined ? -1 : (component[first.origin] ?? -1),
        box: unionOf(cycle.map((h) => edgeOf(ctx, h).box)),
      };
    });
    const faces = loops.filter((l) => l.area > 0);
    const boundaries = loops.filter((l) => l.area < 0);
    // A lone circle is its own component: one bounded face and its outer boundary.
    circles.forEach((c, i) => {
      const area = Math.PI * c.curve.radius ** 2;
      const loop = { halves: [], circle: c, component: nodes.length + i, box: c.box };
      faces.push({ ...loop, area });
      boundaries.push({ ...loop, area: -area });
    });

    // 6. Holes: each outer boundary goes to the smallest face of another component containing it.
    const holes = new Map<Loop, Loop[]>(faces.map((f) => [f, []]));
    for (const boundary of boundaries) {
      const sample = samplePoint(ctx, boundary);
      let best: Loop | undefined;
      for (const face of faces) {
        if (face.component === boundary.component) continue;
        if (best !== undefined && face.area >= best.area) continue;
        if (contains(ctx, face, sample)) best = face;
      }
      if (best !== undefined) holes.get(best)?.push(boundary);
    }

    // 7. Names from curve ids.
    const regions = faces.map((face): ProfileRegion => {
      const faceHoles = holes.get(face) ?? [];
      const ids = new Set([face, ...faceHoles].flatMap((l) => idsOf(ctx, l)));
      return Object.freeze({
        name: [...ids].sort(compareStrings).join(','),
        outer: curvesOf(ctx, face),
        holes: Object.freeze(faceHoles.map((h) => curvesOf(ctx, h))),
        area: faceHoles.reduce((sum, h) => sum + h.area, face.area),
      });
    });
    regions.sort((a, b) => compareStrings(a.name, b.name));
    return Object.freeze({ regions: Object.freeze(regions), crossing: false });
  } finally {
    for (const g of owned) g.delete();
  }
}

// --- Curves -----------------------------------------------------------------------------------

/** Every coordinate of a curve: its points, and the center of an arc or a circle. */
function coordinatesOf(c: ProfileCurve): readonly number[] {
  switch (c.kind) {
    case 'line':
      return [...c.from, ...c.to];
    case 'arc':
      return [...c.center, ...c.from, ...c.to];
    case 'circle':
      return [...c.center];
    case 'bspline':
      return c.poles.flat();
  }
}

/** An arc running counter-clockwise from `from` to `to` (the same arc); other curves unchanged. */
function counterClockwise(c: IdentifiedCurve): IdentifiedCurve {
  if (c.kind !== 'arc' || c.ccw) return c;
  return { kind: 'arc', center: c.center, from: c.to, to: c.from, ccw: true, id: c.id };
}

function startOf(c: Bounded): Vec2 {
  return c.kind === 'bspline' ? (c.poles[0] ?? [Number.NaN, Number.NaN]) : c.from;
}

function endOf(c: Bounded): Vec2 {
  return c.kind === 'bspline' ? (c.poles[c.poles.length - 1] ?? [Number.NaN, Number.NaN]) : c.to;
}

/**
 * New Geom2d curve of a line, a counter-clockwise arc or a spline, parametrised from its start
 * to its end; the caller owns it.
 */
function boundedCurve(oc: Occt, c: Bounded): Geom2d_Curve {
  switch (c.kind) {
    case 'line': {
      using from = new oc.gp_Pnt2d(c.from[0], c.from[1]);
      using to = new oc.gp_Pnt2d(c.to[0], c.to[1]);
      using maker = new oc.GC_MakeSegment2d(from, to);
      return maker.Value();
    }
    case 'arc': {
      const radius = dist(c.center, c.from);
      using circle = circleOf(oc, c.center, radius);
      using from = new oc.gp_Pnt2d(c.from[0], c.from[1]);
      using to = new oc.gp_Pnt2d(c.to[0], c.to[1]);
      using maker = new oc.GC_MakeArcOfCircle2d(circle, from, to, true);
      return maker.Value();
    }
    case 'bspline': {
      const { knots, multiplicities } = compressKnots(c.knots);
      using poles = new oc.NCollection_Array1_gp_Pnt2d(c.poles.length);
      c.poles.forEach((q, i) => {
        using pole = new oc.gp_Pnt2d(q[0], q[1]);
        poles.SetValue(i, pole);
      });
      using knotArray = new oc.NCollection_Array1_double(knots.length);
      using multArray = new oc.NCollection_Array1_int(knots.length);
      knots.forEach((k, i) => {
        knotArray.SetValue(i, k);
        multArray.SetValue(i, multiplicities[i] ?? 0);
      });
      return new oc.Geom2d_BSplineCurve(poles, knotArray, multArray, c.degree, false);
    }
  }
}

/** New counter-clockwise Geom2d_Circle; the caller owns it. */
function circleCurve(oc: Occt, c: Circle): Geom2d_Curve {
  using center = new oc.gp_Pnt2d(c.center[0], c.center[1]);
  using xDir = new oc.gp_Dir2d(1, 0);
  using axis = new oc.gp_Ax2d(center, xDir);
  return new oc.Geom2d_Circle(axis, c.radius, true);
}

/** New counter-clockwise gp_Circ2d. */
function circleOf(oc: Occt, center: Vec2, radius: number) {
  using c = new oc.gp_Pnt2d(center[0], center[1]);
  using xDir = new oc.gp_Dir2d(1, 0);
  using axis = new oc.gp_Ax2d(c, xDir);
  return new oc.gp_Circ2d(axis, radius, true);
}

/**
 * A box around the curve grown by `tol`: an arc by its whole circle, a spline by its poles (the
 * curve lies in their convex hull).
 */
function boxOf(c: IdentifiedCurve, tol: number): Box {
  let points: readonly Vec2[];
  switch (c.kind) {
    case 'line':
      points = [c.from, c.to];
      break;
    case 'arc': {
      const r = dist(c.center, c.from);
      points = [
        [c.center[0] - r, c.center[1] - r],
        [c.center[0] + r, c.center[1] + r],
      ];
      break;
    }
    case 'circle':
      points = [
        [c.center[0] - c.radius, c.center[1] - c.radius],
        [c.center[0] + c.radius, c.center[1] + c.radius],
      ];
      break;
    case 'bspline':
      points = c.poles;
  }
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  return [
    Math.min(...xs) - tol,
    Math.min(...ys) - tol,
    Math.max(...xs) + tol,
    Math.max(...ys) + tol,
  ];
}

function unionOf(boxes: readonly Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function inBox(b: Box, q: Vec2): boolean {
  return q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
}

// --- Areas ------------------------------------------------------------------------------------

/**
 * Where the Green integral of a curve is split: a line in one piece, an arc into PIECES_PER_TURN
 * pieces per turn, a spline at its knots (each span further for a degree over
 * EXACT_SPLINE_DEGREE).
 */
function breaksOf(c: Bounded, g: Geom2d_Curve): readonly number[] {
  const a = g.FirstParameter();
  const b = g.LastParameter();
  if (c.kind === 'line') return [a, b];
  if (c.kind === 'arc')
    return split([a, b], Math.ceil(((b - a) / (2 * Math.PI)) * PIECES_PER_TURN));
  const knots = [...new Set(c.knots)];
  return split(knots, Math.ceil(c.degree / EXACT_SPLINE_DEGREE));
}

/** Each interval between consecutive values split into `pieces` equal parts. */
function split(values: readonly number[], pieces: number): readonly number[] {
  const n = Math.max(1, pieces);
  const out: number[] = [];
  values.forEach((u, i) => {
    const next = values[i + 1];
    if (next === undefined) {
      out.push(u);
      return;
    }
    for (let k = 0; k < n; k++) out.push(u + ((next - u) * k) / n);
  });
  return out;
}

/** ∫ (x y' − y x') / 2 du over the parameter range of `g` split at `breaks` (Gauss–Legendre). */
function greenOf(g: Geom2d_Curve, breaks: readonly number[], p: gp_Pnt2d, v: gp_Vec2d): number {
  let sum = 0;
  for (let i = 1; i < breaks.length; i++) {
    const u0 = breaks[i - 1] ?? 0;
    const u1 = breaks[i] ?? 0;
    const half = (u1 - u0) / 2;
    for (const [x, w] of GAUSS_LEGENDRE) {
      g.D1(u0 + half * (1 + x), p, v);
      sum += w * half * (p.X() * v.Y() - p.Y() * v.X());
    }
  }
  return sum / 2;
}

/** A point of a boundary loop: its first node, or the rightmost point of a lone circle. */
function samplePoint(ctx: Context, loop: Loop): Vec2 {
  if (loop.circle !== undefined) {
    const { center, radius } = loop.circle.curve;
    return [center[0] + radius, center[1]];
  }
  const first = loop.halves[0];
  return first === undefined
    ? [Number.NaN, Number.NaN]
    : (ctx.nodes[first.origin] ?? [Number.NaN, Number.NaN]);
}

// --- Crossing ---------------------------------------------------------------------------------

/** A curve for the crossing check: an edge with its nodes, or a lone circle without any. */
interface Shape {
  readonly g: Geom2d_Curve;
  readonly box: Box;
  readonly nodes: readonly number[];
  readonly selfCheck: 'none' | 'open' | 'closed';
}

/**
 * Whether two curves have a common point other than a shared end node, or a spline crosses
 * itself. Pairs are found by sweeping the boxes along x; only overlapping boxes reach OCCT.
 */
function crosses(ctx: Context, circles: readonly LoneCircle[]): boolean {
  const { oc, tol, nodeTol, nodes } = ctx;
  const shapes: Shape[] = [
    ...ctx.edges.map((e): Shape => ({
      g: e.g,
      box: e.box,
      nodes: [e.from, e.to],
      selfCheck: e.curve.kind !== 'bspline' ? 'none' : e.from === e.to ? 'closed' : 'open',
    })),
    ...circles.map((c): Shape => ({ g: c.g, box: c.box, nodes: [], selfCheck: 'none' })),
  ];
  for (const s of shapes) {
    if (s.selfCheck !== 'none' && crossesItself(ctx, s)) return true;
  }
  const order = shapes
    .map((_, i) => i)
    .sort((i, j) => (shapes[i]?.box[0] ?? 0) - (shapes[j]?.box[0] ?? 0));
  for (let k = 0; k < order.length; k++) {
    const a = shapes[order[k] ?? -1];
    if (a === undefined) continue;
    for (let m = k + 1; m < order.length; m++) {
      const b = shapes[order[m] ?? -1];
      if (b === undefined) continue;
      if (b.box[0] > a.box[2]) break;
      if (!boxesOverlap(a.box, b.box)) continue;
      using inter = new oc.Geom2dAPI_InterCurveCurve(a.g, b.g, tol);
      if (inter.NbSegments() > 0) return true;
      const shared = a.nodes.filter((n) => b.nodes.includes(n));
      for (let i = 1; i <= inter.NbPoints(); i++) {
        using point = inter.Point(i);
        const q: Vec2 = [point.X(), point.Y()];
        const atShared = shared.some((n) => {
          const node = nodes[n];
          return node !== undefined && dist(node, q) <= nodeTol;
        });
        if (!atShared) return true;
      }
    }
  }
  return false;
}

/**
 * A spline crosses itself (spec 12 "Spliny (M29)"): any self-intersection or a piece running
 * over itself. A closed spline meets itself in its node; that is a crossing only when the curve
 * also passes through the node inside its parameter range (a figure eight through the node).
 */
function crossesItself(ctx: Context, s: Shape): boolean {
  const { oc, tol, nodeTol, nodes } = ctx;
  using inter = new oc.Geom2dAPI_InterCurveCurve(s.g, tol);
  if (inter.NbSegments() > 0) return true;
  if (inter.NbPoints() === 0) return false;
  const node = s.selfCheck === 'closed' ? nodes[s.nodes[0] ?? -1] : undefined;
  if (node === undefined) return true;
  for (let i = 1; i <= inter.NbPoints(); i++) {
    using point = inter.Point(i);
    if (dist(node, [point.X(), point.Y()]) > nodeTol) return true;
  }
  return passesInside(ctx, s.g, node);
}

/** Whether `g` comes within nodeTol of `node` at a parameter clearly inside its range. */
function passesInside(ctx: Context, g: Geom2d_Curve, node: Vec2): boolean {
  const { oc, nodeTol } = ctx;
  const a = g.FirstParameter();
  const b = g.LastParameter();
  const margin = TANGENT_STEP * (b - a);
  using point = new oc.gp_Pnt2d(node[0], node[1]);
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(point, g);
  for (let i = 1; i <= projection.NbPoints(); i++) {
    const u = projection.Parameter(i);
    if (projection.Distance(i) <= nodeTol && u > a + margin && u < b - margin) return true;
  }
  return false;
}

// --- Graph ------------------------------------------------------------------------------------

/** Removes edges at nodes of degree 1 until there are none; returns the surviving edge indices. */
function prune(edges: readonly Edge[], nodeCount: number): readonly number[] {
  const degree = new Array<number>(nodeCount).fill(0);
  for (const e of edges) {
    degree[e.from] = (degree[e.from] ?? 0) + 1;
    degree[e.to] = (degree[e.to] ?? 0) + 1;
  }
  const alive = new Set(edges.map((_, i) => i));
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of alive) {
      const e = edges[i];
      if (e === undefined) continue;
      if (degree[e.from] === 1 || degree[e.to] === 1) {
        alive.delete(i);
        degree[e.from] = (degree[e.from] ?? 0) - 1;
        degree[e.to] = (degree[e.to] ?? 0) - 1;
        changed = true;
      }
    }
  }
  return [...alive].sort((i, j) => i - j);
}

/** Connected component of every node (union-find over the edges). */
function components(edges: readonly (Edge | undefined)[], nodeCount: number): readonly number[] {
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  for (const e of edges) {
    if (e !== undefined) parent[find(e.from)] = find(e.to);
  }
  return parent.map((_, i) => find(i));
}

/**
 * Forward (from → to) and reverse half-edges of edge `index`: the tangent leaving the node and
 * the signed curvature κ = (x'y'' − y'x'') / |r'|³ from the derivatives at the end; reversing the
 * direction flips the tangent and the sign of κ.
 */
function halfEdges(
  ctx: Context,
  index: number,
  e: Edge | undefined,
  p: gp_Pnt2d,
  v1: gp_Vec2d,
  v2: gp_Vec2d,
): readonly HalfEdge[] {
  if (e === undefined) return [];
  const a = e.g.FirstParameter();
  const b = e.g.LastParameter();
  const start = leaving(ctx, e.g, a, b - a, p, v1, v2);
  const end = leaving(ctx, e.g, b, a - b, p, v1, v2);
  return [
    { edge: index, forward: true, origin: e.from, dest: e.to, ...start },
    { edge: index, forward: false, origin: e.to, dest: e.from, ...end },
  ];
}

/**
 * Direction and signed curvature of the curve leaving its end at parameter `u` towards the
 * inside of its range (`inward` is the signed length of the range seen from that end). Where the
 * first derivative vanishes, the chord to a point TANGENT_STEP inside gives the direction.
 */
function leaving(
  ctx: Context,
  g: Geom2d_Curve,
  u: number,
  inward: number,
  p: gp_Pnt2d,
  v1: gp_Vec2d,
  v2: gp_Vec2d,
): { readonly angle: number; readonly curvature: number } {
  g.D2(u, p, v1, v2);
  const sign = Math.sign(inward);
  const d: Vec2 = [v1.X(), v1.Y()];
  const dd: Vec2 = [v2.X(), v2.Y()];
  const speed = Math.hypot(d[0], d[1]);
  if (speed === 0) {
    const origin: Vec2 = [p.X(), p.Y()];
    using inside = new ctx.oc.gp_Pnt2d(0, 0);
    g.D0(u + TANGENT_STEP * inward, inside);
    return { angle: direction([inside.X() - origin[0], inside.Y() - origin[1]]), curvature: 0 };
  }
  const kappa = (d[0] * dd[1] - d[1] * dd[0]) / speed ** 3;
  return { angle: direction([sign * d[0], sign * d[1]]), curvature: sign * kappa };
}

/** Angle in [0, 2π); a value within the tie tolerance of 2π becomes 0, so ties do not split at the wrap. */
function direction(d: Vec2): number {
  const turn = 2 * Math.PI;
  const angle = ((Math.atan2(d[1], d[0]) % turn) + turn) % turn;
  return turn - angle <= ANGLE_TIE ? 0 : angle;
}

/**
 * All face cycles of the graph. Outgoing half-edges are sorted counter-clockwise around each node
 * by tangent angle, a tie by signed curvature (the one turning more left is further). next(e) is
 * the outgoing half-edge at e's destination right clockwise of twin(e): the face is on the left.
 * `halves` holds the forward and the reverse half-edge of each edge next to each other.
 */
function traceLoops(
  halves: readonly HalfEdge[],
  nodeCount: number,
): readonly (readonly HalfEdge[])[] {
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
  const cycles: HalfEdge[][] = [];
  for (let startIndex = 0; startIndex < halves.length; startIndex++) {
    if (visited[startIndex] === true) continue;
    const cycle: HalfEdge[] = [];
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

function edgeOf(ctx: Context, h: HalfEdge): Edge {
  const e = ctx.edges[h.edge];
  if (e === undefined) throw new Error(`regions: half-edge of a missing edge ${String(h.edge)}`);
  return e;
}

// --- Containment ------------------------------------------------------------------------------

/**
 * Whether `q` lies inside the face loop (q is never on it: crossings are excluded). A circle by
 * its radius; otherwise the parity of the hits of a ray from q, intersected with each curve by
 * Geom2dAPI_InterCurveCurve. A ray through a node, along a curve or grazing one is degenerate;
 * the next direction is tried then.
 */
function contains(ctx: Context, face: Loop, q: Vec2): boolean {
  if (face.circle !== undefined) {
    return dist(face.circle.curve.center, q) < face.circle.curve.radius;
  }
  if (!inBox(face.box, q)) return false;
  let hits = 0;
  for (let attempt = 0; attempt < RAY_ATTEMPTS; attempt++) {
    const angle = RAY_ANGLE + attempt * GOLDEN_ANGLE;
    const far: Vec2 = [
      q[0] + Math.cos(angle) * ctx.rayLength,
      q[1] + Math.sin(angle) * ctx.rayLength,
    ];
    const count = rayHits(ctx, face, q, far);
    hits = count.hits;
    if (count.clean) break;
  }
  return hits % 2 === 1;
}

/** Hits of the ray segment q → far with the loop's curves, and whether none is degenerate. */
function rayHits(
  ctx: Context,
  face: Loop,
  q: Vec2,
  far: Vec2,
): { readonly hits: number; readonly clean: boolean } {
  const { oc, tol, nodeTol } = ctx;
  const d: Vec2 = [far[0] - q[0], far[1] - q[1]];
  const length = Math.hypot(d[0], d[1]);
  using from = new oc.gp_Pnt2d(q[0], q[1]);
  using to = new oc.gp_Pnt2d(far[0], far[1]);
  using maker = new oc.GC_MakeSegment2d(from, to);
  const ray = maker.Value();
  try {
    let hits = 0;
    for (const h of face.halves) {
      const e = edgeOf(ctx, h);
      if (!segmentMeetsBox(q, far, e.box)) continue;
      using inter = new oc.Geom2dAPI_InterCurveCurve(ray, e.g, tol);
      if (inter.NbSegments() > 0) return { hits, clean: false };
      const ends = [ctx.nodes[e.from], ctx.nodes[e.to]];
      for (let i = 1; i <= inter.NbPoints(); i++) {
        using point = inter.Point(i);
        const hit: Vec2 = [point.X(), point.Y()];
        if (ends.some((n) => n !== undefined && dist(n, hit) <= nodeTol)) {
          return { hits, clean: false };
        }
        if (grazes(ctx, e.g, point, [d[0] / length, d[1] / length])) {
          return { hits, clean: false };
        }
        hits++;
      }
    }
    return { hits, clean: true };
  } finally {
    ray.delete();
  }
}

/** Whether the curve's tangent at its point nearest to `point` is (nearly) parallel to `dir`. */
function grazes(ctx: Context, g: Geom2d_Curve, point: gp_Pnt2d, dir: Vec2): boolean {
  const { oc } = ctx;
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(point, g);
  if (projection.NbPoints() === 0) return false;
  using p = new oc.gp_Pnt2d(0, 0);
  using v = new oc.gp_Vec2d(0, 0);
  g.D1(projection.LowerDistanceParameter(), p, v);
  const speed = Math.hypot(v.X(), v.Y());
  if (speed === 0) return true;
  return Math.abs(dir[0] * v.Y() - dir[1] * v.X()) <= GRAZING_SINE * speed;
}

/** Whether segment a → b meets the box (slab test). */
function segmentMeetsBox(a: Vec2, b: Vec2, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const axis of [0, 1] as const) {
    const start = a[axis];
    const delta = b[axis] - start;
    const lo = box[axis];
    const hi = box[axis + 2] ?? lo;
    if (delta === 0) {
      if (start < lo || start > hi) return false;
      continue;
    }
    const u = (lo - start) / delta;
    const w = (hi - start) / delta;
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 > t1) return false;
  }
  return true;
}

// --- Result -----------------------------------------------------------------------------------

function idsOf(ctx: Context, loop: Loop): readonly string[] {
  if (loop.circle !== undefined) return [loop.circle.curve.id];
  return loop.halves.map((h) => edgeOf(ctx, h).curve.id);
}

/**
 * The input curves of a loop, each oriented along it: a forward half-edge is the curve as it is
 * (an arc counter-clockwise), a reverse one the same curve backwards.
 */
function curvesOf(ctx: Context, loop: Loop): readonly ProfileCurve[] {
  if (loop.circle !== undefined) return Object.freeze([loop.circle.curve]);
  return Object.freeze(
    loop.halves.map((h) => {
      const { curve } = edgeOf(ctx, h);
      return h.forward ? curve : reversed(curve);
    }),
  );
}

/**
 * The same curve traversed backwards: a line with swapped ends, an arc clockwise, a spline with
 * the poles reversed and the knots mirrored in their range (k → a + b − k, reversed).
 */
function reversed(c: Bounded): Bounded {
  switch (c.kind) {
    case 'line':
      return { kind: 'line', from: c.to, to: c.from, id: c.id };
    case 'arc':
      return { kind: 'arc', center: c.center, from: c.to, to: c.from, ccw: !c.ccw, id: c.id };
    case 'bspline': {
      const a = c.knots[0] ?? 0;
      const b = c.knots[c.knots.length - 1] ?? 0;
      return {
        kind: 'bspline',
        degree: c.degree,
        poles: [...c.poles].reverse(),
        knots: c.knots.map((k) => a + b - k).reverse(),
        id: c.id,
      };
    }
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Plain string comparison by UTF-16 code units (spec 12: names sorted by string comparison). */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
