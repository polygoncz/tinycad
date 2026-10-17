import { bspline, mod2pi, TWO_PI, type Vec2, vec2 } from '@/core';
import { lineLine, lineRound, onRound, roundRound, type Round } from './fake-regions';
import type {
  CurveIntersection,
  CurveSegmentInput,
  IdentifiedCurve,
  ProfileCurve,
} from './profile';

const { addScaled, angleOf, cross, dist, dot, sub } = vec2;

// curveIntersections and curveSegment of the FakeKernel (spec 06 "Stav po M33", spec 12 "Port a
// parametr křivky"). Intersections of lines, arcs and circles come from the formulas of the
// region algorithm (fake-regions.ts); a spline meets other curves through a sampling of its
// knot spans, each candidate refined by Newton's method on the exact curves, so its points
// agree with OCCT within the contract tolerance. Pieces of lines and arcs from the formulas, of
// a spline by knot insertion (Boehm). Internal to kernel.

/** Spec 06: two points coincide within this · max(1, |coordinate|), per coordinate. */
const POINT_TOLERANCE = 1e-7;
/** Tolerance of the intersection formulas, times the scale (as the regions). */
const FORMULA_TOLERANCE = 1e-9;
/** Chords of the sampling per knot span and degree of a spline. */
const SAMPLES_PER_SPAN_DEGREE = 16;
/** At most this many Newton steps refine a candidate. */
const NEWTON_STEPS = 50;
/** A Newton step shorter than this · the scale ends the refinement. */
const NEWTON_STEP_TOLERANCE = 1e-15;
/** A refined point farther than this · the scale from the other curve is no intersection. */
const NEWTON_RESIDUAL = 1e-9;

type Spline = Extract<ProfileCurve, { kind: 'bspline' }>;

/** A sample of a spline: its parameter and point. */
interface Sample {
  readonly u: number;
  readonly p: Vec2;
}

/** A curve prepared for the intersections: its shape for the formulas. */
type Prepared =
  | { readonly kind: 'line'; readonly curve: IdentifiedCurve; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'round'; readonly curve: IdentifiedCurve; readonly round: Round }
  | {
      readonly kind: 'spline';
      readonly curve: IdentifiedCurve & Spline;
      readonly samples: readonly Sample[];
    };

/** A common point found for a pair, with the spline parameters where a spline gave them. */
interface RawHit {
  readonly point: Vec2;
  readonly ua?: number;
  readonly ub?: number;
  readonly overlap: boolean;
}

/** The point on the curve and its derivative at a parameter (the curve's own one). */
type Evaluator = (u: number) => { readonly p: Vec2; readonly d: Vec2 };

/**
 * Every common point of each pair of `curves` (checked by parseProfileRegionsInput: ids present
 * and unique, no curve of zero length) and of each spline with itself, ordered by a, b, ta.
 */
export function computeCurveIntersections(
  curves: readonly IdentifiedCurve[],
): readonly CurveIntersection[] {
  const scale = Math.max(1, ...curves.flatMap(coordinatesOf).map(Math.abs));
  const tol = FORMULA_TOLERANCE * scale;
  const prepared = curves.map(prepare);
  const out: CurveIntersection[] = [];
  prepared.forEach((a, i) => {
    if (a.kind === 'spline') out.push(...finish(a.curve, a.curve, selfHits(a, scale, tol)));
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j];
      if (b !== undefined) out.push(...finish(a.curve, b.curve, pairHits(a, b, scale, tol)));
    }
  });
  return Object.freeze(out);
}

/**
 * The piece of the checked curve between from < to (parseCurveSegmentInput): a line or an arc of
 * the same kind and direction, a circle as a counter-clockwise arc, a spline by knot insertion
 * with the knots of the piece rescaled to [0, 1]. The id of the input stays.
 */
export function computeCurveSegment({ curve, from, to }: CurveSegmentInput): ProfileCurve {
  const id = curve.id === undefined ? {} : { id: curve.id };
  switch (curve.kind) {
    case 'line': {
      const d = sub(curve.to, curve.from);
      const at = (t: number): Vec2 =>
        t === 0 ? curve.from : t === 1 ? curve.to : addScaled(curve.from, d, t);
      return { kind: 'line', from: at(from), to: at(to), ...id };
    }
    case 'arc': {
      const r = dist(curve.center, curve.from);
      const a0 = angleOf(sub(curve.from, curve.center));
      const sweep = arcSweep(curve);
      const sign = curve.ccw ? 1 : -1;
      const at = (t: number): Vec2 =>
        t === 0 ? curve.from : t === sweep ? curve.to : onCircle(curve.center, r, a0 + sign * t);
      return {
        kind: 'arc',
        center: curve.center,
        from: at(from),
        to: at(to),
        ccw: curve.ccw,
        ...id,
      };
    }
    case 'circle':
      return {
        kind: 'arc',
        center: curve.center,
        from: onCircle(curve.center, curve.radius, from),
        to: onCircle(curve.center, curve.radius, to),
        ccw: true,
        ...id,
      };
    case 'bspline':
      return { ...splineSegment(curve, from, to), ...id };
  }
}

// --- Intersections ----------------------------------------------------------------------------

function prepare(curve: IdentifiedCurve): Prepared {
  switch (curve.kind) {
    case 'line':
      return { kind: 'line', curve, a: curve.from, b: curve.to };
    case 'circle':
      return {
        kind: 'round',
        curve,
        round: { c: curve.center, r: curve.radius, start: 0, sweep: TWO_PI, full: true, ends: [] },
      };
    case 'arc': {
      // Counter-clockwise from `start` over `sweep`, as the region formulas take an arc.
      const [from, to] = curve.ccw ? [curve.from, curve.to] : [curve.to, curve.from];
      const start = angleOf(sub(from, curve.center));
      return {
        kind: 'round',
        curve,
        round: {
          c: curve.center,
          r: dist(curve.center, from),
          start,
          sweep: mod2pi(angleOf(sub(to, curve.center)) - start),
          full: false,
          ends: [from, to],
        },
      };
    }
    case 'bspline':
      return { kind: 'spline', curve, samples: samplesOf(curve) };
  }
}

/** Points of a pair of different curves. */
function pairHits(a: Prepared, b: Prepared, scale: number, tol: number): readonly RawHit[] {
  if (a.kind === 'spline' || b.kind === 'spline') return splineHits(a, b, scale, tol);
  if (a.kind === 'line' && b.kind === 'line') {
    const contact = lineLine(a.a, a.b, b.a, b.b, tol);
    if (contact !== 'overlap') return contact.map(plain);
    return lineOverlapEnds(a, b).map((point) => ({ point, overlap: true }));
  }
  if (a.kind === 'line' && b.kind === 'round') return lineRound(a, b.round, tol).map(plain);
  if (a.kind === 'round' && b.kind === 'line') return lineRound(b, a.round, tol).map(plain);
  if (a.kind === 'round' && b.kind === 'round') {
    const contact = roundRound(a.round, b.round, tol);
    if (contact !== 'overlap') return contact.map(plain);
    // The ends of the shared pieces, and ends that only touch the other arc.
    return [
      ...roundOverlapEnds(a.round, b.round, tol).map((point) => ({ point, overlap: true })),
      ...a.round.ends.filter((p) => onRound(b.round, p, tol)).map(plain),
      ...b.round.ends.filter((p) => onRound(a.round, p, tol)).map(plain),
    ];
  }
  return [];
}

function plain(point: Vec2): RawHit {
  return { point, overlap: false };
}

/** Both ends of the shared piece of two collinear overlapping lines. */
function lineOverlapEnds(
  a: Extract<Prepared, { kind: 'line' }>,
  b: Extract<Prepared, { kind: 'line' }>,
): readonly Vec2[] {
  const d = sub(a.b, a.a);
  const len2 = dot(d, d);
  const t0 = dot(sub(b.a, a.a), d) / len2;
  const t1 = dot(sub(b.b, a.a), d) / len2;
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(1, Math.max(t0, t1));
  // An end of either line where it lies, so the shared ends are exact.
  const at = (t: number): Vec2 =>
    t === 0 ? a.a : t === 1 ? a.b : t === t0 ? b.a : t === t1 ? b.b : addScaled(a.a, d, t);
  return [at(lo), at(hi)];
}

/**
 * The ends of the pieces two arcs of one circle share, in the angular frame of `a`. Two full
 * circles share everything and have no ends; a circle and an arc share the arc.
 */
function roundOverlapEnds(a: Round, b: Round, tol: number): readonly Vec2[] {
  if (a.full && b.full) return [];
  if (a.full) return b.ends;
  if (b.full) return a.ends;
  const eps = tol / a.r;
  const offset = mod2pi(b.start - a.start);
  const ends: Vec2[] = [];
  for (const shift of [offset, offset - TWO_PI]) {
    const lo = Math.max(0, shift);
    const hi = Math.min(a.sweep, shift + b.sweep);
    if (hi - lo > eps)
      ends.push(onCircle(a.c, a.r, a.start + lo), onCircle(a.c, a.r, a.start + hi));
  }
  return ends;
}

/**
 * Points of a spline with another curve: crossings of the spline's chords with the other curve
 * (or its chords), refined by Newton's method on the exact curves. Overlaps are not looked for.
 */
function splineHits(a: Prepared, b: Prepared, scale: number, tol: number): readonly RawHit[] {
  const hits: RawHit[] = [];
  const evalA = evaluatorOf(a);
  const evalB = evaluatorOf(b);
  for (const [chordA, chordB] of chordPairs(a, b)) {
    const contact = chordContact(chordA, chordB, a, b, tol);
    for (const point of contact) {
      const ua = guessParam(a, chordA, point);
      const ub = guessParam(b, chordB, point);
      const refined = newton(evalA, evalB, ua, ub, scale);
      const ra = clampParam(a, refined.u);
      const rb = clampParam(b, refined.v);
      const pa = evalA(ra).p;
      if (dist(pa, evalB(rb).p) > NEWTON_RESIDUAL * scale) continue;
      if (!withinDomain(b, pa, tol) || !withinDomain(a, pa, tol)) continue;
      hits.push({
        point: pa,
        ...(a.kind === 'spline' ? { ua: ra } : {}),
        ...(b.kind === 'spline' ? { ub: rb } : {}),
        overlap: false,
      });
    }
  }
  return hits;
}

/** A spline crossing itself: non-adjacent chords meeting, and the node of a closed spline. */
function selfHits(
  s: Extract<Prepared, { kind: 'spline' }>,
  scale: number,
  tol: number,
): readonly RawHit[] {
  const { curve, samples } = s;
  const [u0, u1] = knotRange(curve);
  const hits: RawHit[] = [];
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first !== undefined && last !== undefined && samePoint(first.p, last.p)) {
    hits.push({ point: first.p, ua: u0, ub: u1, overlap: false });
  }
  const evaluate = evaluatorOf(s);
  for (let i = 1; i < samples.length; i++) {
    for (let j = i + 2; j < samples.length; j++) {
      const p0 = samples[i - 1];
      const p1 = samples[i];
      const q0 = samples[j - 1];
      const q1 = samples[j];
      if (p0 === undefined || p1 === undefined || q0 === undefined || q1 === undefined) continue;
      const contact = lineLine(p0.p, p1.p, q0.p, q1.p, tol);
      if (contact === 'overlap') continue;
      for (const point of contact) {
        const refined = newton(
          evaluate,
          evaluate,
          chordParam(p0, p1, point),
          chordParam(q0, q1, point),
          scale,
        );
        const ua = Math.min(Math.max(Math.min(refined.u, refined.v), u0), u1);
        const ub = Math.min(Math.max(Math.max(refined.u, refined.v), u0), u1);
        const pa = evaluate(ua).p;
        if (ub - ua <= FORMULA_TOLERANCE * (u1 - u0)) continue;
        if (dist(pa, evaluate(ub).p) > NEWTON_RESIDUAL * scale) continue;
        hits.push({ point: pa, ua, ub, overlap: false });
      }
    }
  }
  return hits;
}

/** A straight chord of a spline between two samples, with their parameters. */
interface Chord {
  readonly p0: Sample;
  readonly p1: Sample;
}

/** The chords of a spline paired with the chords of another spline, or with the whole other curve. */
function chordPairs(
  a: Prepared,
  b: Prepared,
): readonly (readonly [Chord | undefined, Chord | undefined])[] {
  const chordsA = a.kind === 'spline' ? chordsOf(a.samples) : [undefined];
  const chordsB = b.kind === 'spline' ? chordsOf(b.samples) : [undefined];
  return chordsA.flatMap((ca) => chordsB.map((cb) => [ca, cb] as const));
}

function chordsOf(samples: readonly Sample[]): readonly Chord[] {
  const chords: Chord[] = [];
  for (let i = 1; i < samples.length; i++) {
    const p0 = samples[i - 1];
    const p1 = samples[i];
    if (p0 !== undefined && p1 !== undefined && dist(p0.p, p1.p) > 0) chords.push({ p0, p1 });
  }
  return chords;
}

/** Common points of a chord (or the curve itself when no chord) with the other. */
function chordContact(
  chordA: Chord | undefined,
  chordB: Chord | undefined,
  a: Prepared,
  b: Prepared,
  tol: number,
): readonly Vec2[] {
  const segA = chordA === undefined ? straightOf(a) : { a: chordA.p0.p, b: chordA.p1.p };
  const segB = chordB === undefined ? straightOf(b) : { a: chordB.p0.p, b: chordB.p1.p };
  if (segA !== undefined && segB !== undefined) {
    const contact = lineLine(segA.a, segA.b, segB.a, segB.b, tol);
    return contact === 'overlap' ? [] : contact;
  }
  // One side is a chord, the other a round (the formulas take its whole circle range).
  if (segA !== undefined && b.kind === 'round') return lineRound(segA, b.round, tol);
  if (segB !== undefined && a.kind === 'round') return lineRound(segB, a.round, tol);
  return [];
}

/** A line as a segment; undefined for other curves. */
function straightOf(c: Prepared): { readonly a: Vec2; readonly b: Vec2 } | undefined {
  return c.kind === 'line' ? { a: c.a, b: c.b } : undefined;
}

/** A first guess of the curve's own parameter at a point found on a chord (or on the curve). */
function guessParam(c: Prepared, chord: Chord | undefined, p: Vec2): number {
  if (chord !== undefined) return chordParam(chord.p0, chord.p1, p);
  if (c.kind === 'line') {
    const d = sub(c.b, c.a);
    return dot(sub(p, c.a), d) / dot(d, d);
  }
  if (c.kind === 'round') return angleOf(sub(p, c.round.c));
  return 0;
}

/** The parameter at a point of a chord, interpolated between its ends. */
function chordParam(p0: Sample, p1: Sample, p: Vec2): number {
  const d = sub(p1.p, p0.p);
  const s = Math.min(1, Math.max(0, dot(sub(p, p0.p), d) / dot(d, d)));
  return p0.u + (p1.u - p0.u) * s;
}

/**
 * The curve's own parametrisation for Newton's method: a line by [0, 1], a round by the absolute
 * angle, a spline by its knots.
 */
function evaluatorOf(c: Prepared): Evaluator {
  switch (c.kind) {
    case 'line': {
      const d = sub(c.b, c.a);
      return (u) => ({ p: addScaled(c.a, d, u), d });
    }
    case 'round': {
      const { c: center, r } = c.round;
      return (u) => ({ p: onCircle(center, r, u), d: [-r * Math.sin(u), r * Math.cos(u)] });
    }
    case 'spline':
      return (u) => ({
        p: bspline.evaluate(c.curve, u),
        d: bspline.derivative(c.curve, u, 1),
      });
  }
}

/**
 * Newton's method on A(u) − B(v) = 0 from (u, v). Stops at a short step, a singular Jacobian
 * (tangency: the start is kept) or after NEWTON_STEPS.
 */
function newton(
  evalA: Evaluator,
  evalB: Evaluator,
  u0: number,
  v0: number,
  scale: number,
): { readonly u: number; readonly v: number } {
  let u = u0;
  let v = v0;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const a = evalA(u);
    const b = evalB(v);
    const f = sub(a.p, b.p);
    // [a.d, −b.d] · [du, dv] = −f
    const det = -cross(a.d, b.d);
    if (Math.abs(det) <= 1e-14 * Math.max(1, Math.hypot(...a.d) * Math.hypot(...b.d))) break;
    const du = (-f[0] * -b.d[1] - -b.d[0] * -f[1]) / det;
    const dv = (a.d[0] * -f[1] - a.d[1] * -f[0]) / det;
    u += du;
    v += dv;
    if (
      Math.hypot(du * Math.hypot(...a.d), dv * Math.hypot(...b.d)) <=
      NEWTON_STEP_TOLERANCE * scale
    ) {
      break;
    }
  }
  return { u, v };
}

/** A spline parameter clamped into its knot range; a line into [0, 1]; a round unchanged. */
function clampParam(c: Prepared, u: number): number {
  if (c.kind === 'spline') {
    const [u0, u1] = knotRange(c.curve);
    return Math.min(Math.max(u, u0), u1);
  }
  return c.kind === 'line' ? Math.min(Math.max(u, 0), 1) : u;
}

/** Whether the refined point lies in the range of a line (before clamping) or of an arc. */
function withinDomain(c: Prepared, p: Vec2, tol: number): boolean {
  if (c.kind === 'round') return onRound(c.round, p, tol);
  if (c.kind === 'line') {
    const d = sub(c.b, c.a);
    const t = dot(sub(p, c.a), d) / dot(d, d);
    const e = tol / Math.hypot(...d);
    return t >= -e && t <= 1 + e;
  }
  return true;
}

/**
 * The hits of a pair as CurveIntersection: parameters t of spec 12 (a spline's from the
 * refinement), points merged within the contract tolerance (an overlap end wins), sorted by ta.
 */
function finish(
  a: IdentifiedCurve,
  b: IdentifiedCurve,
  hits: readonly RawHit[],
): readonly CurveIntersection[] {
  const merged: RawHit[] = [];
  for (const h of hits) {
    const same = merged.findIndex((m) => samePoint(m.point, h.point));
    if (same === -1) merged.push(h);
    else if (h.overlap) merged[same] = { ...(merged[same] ?? h), overlap: true };
  }
  return merged
    .map((h): CurveIntersection => ({
      a: a.id,
      b: b.id,
      point: h.point,
      ta: h.ua ?? paramOf(a, h.point),
      tb: h.ub ?? paramOf(b, h.point),
      ...(h.overlap ? { overlap: true as const } : {}),
    }))
    .sort((x, y) => x.ta - y.ta);
}

/** The parameter t (spec 12) of a point lying on a line, an arc or a circle. */
function paramOf(c: ProfileCurve, p: Vec2): number {
  switch (c.kind) {
    case 'line': {
      const d = sub(c.to, c.from);
      return Math.min(1, Math.max(0, dot(sub(p, c.from), d) / dot(d, d)));
    }
    case 'circle': {
      const t = mod2pi(angleOf(sub(p, c.center)));
      return t >= TWO_PI ? 0 : t;
    }
    case 'arc': {
      const a0 = angleOf(sub(c.from, c.center));
      const a = angleOf(sub(p, c.center));
      const t = mod2pi(c.ccw ? a - a0 : a0 - a);
      const sweep = arcSweep(c);
      if (t <= sweep) return t;
      // Just outside the arc (rounding): the nearer end.
      return t - sweep < TWO_PI - t ? sweep : 0;
    }
    case 'bspline':
      // Spline parameters come from the refinement; this is never reached.
      return Number.NaN;
  }
}

// --- Splines ----------------------------------------------------------------------------------

/** Samples of a spline: each knot span cut into SAMPLES_PER_SPAN_DEGREE · degree equal steps. */
function samplesOf(curve: Spline): readonly Sample[] {
  const knots = [...new Set(curve.knots)];
  const steps = SAMPLES_PER_SPAN_DEGREE * curve.degree;
  const samples: Sample[] = [];
  knots.forEach((k, i) => {
    const next = knots[i + 1];
    if (next === undefined) {
      samples.push({ u: k, p: bspline.evaluate(curve, k) });
      return;
    }
    for (let s = 0; s < steps; s++) {
      const u = k + ((next - k) * s) / steps;
      samples.push({ u, p: bspline.evaluate(curve, u) });
    }
  });
  return samples;
}

function knotRange(curve: Spline): readonly [number, number] {
  return [curve.knots[0] ?? Number.NaN, curve.knots[curve.knots.length - 1] ?? Number.NaN];
}

/**
 * The piece of a clamped spline between from < to: `from` and `to` inserted (Boehm) until each
 * has multiplicity `degree`, so the curve passes through a pole there; the poles between them
 * with their knots, clamped and rescaled to [0, 1].
 */
function splineSegment(curve: Spline, from: number, to: number): Spline {
  const p = curve.degree;
  let poles: readonly Vec2[] = curve.poles;
  let knots: readonly number[] = curve.knots;
  for (const u of [from, to]) {
    while (multiplicity(knots, u) < p) ({ poles, knots } = insertKnot(p, poles, knots, u));
  }
  // C(from) = P[k − 1] where the block of `from` knots (p of them, or p + 1 at the start)
  // ends at k + p − 1; C(to) = P[m − 1] where the block of `to` knots starts at m.
  const k = knots.lastIndexOf(from) - p + 1;
  const m = knots.indexOf(to);
  const inner = knots.slice(k + p, m);
  const scale = (x: number): number => (x - from) / (to - from);
  return {
    kind: 'bspline',
    degree: p,
    poles: poles.slice(k - 1, m),
    knots: [...Array<number>(p + 1).fill(0), ...inner.map(scale), ...Array<number>(p + 1).fill(1)],
  };
}

function multiplicity(knots: readonly number[], u: number): number {
  return knots.filter((k) => k === u).length;
}

/** One insertion of the knot u (Boehm; Piegl–Tiller A5.1 with r = 1). */
function insertKnot(
  p: number,
  poles: readonly Vec2[],
  knots: readonly number[],
  u: number,
): { readonly poles: readonly Vec2[]; readonly knots: readonly number[] } {
  // The span s with knots[s] ≤ u < knots[s + 1]; u lies inside the range, before its end.
  let s = p;
  while (s + 1 < knots.length && (knots[s + 1] ?? Number.NaN) <= u) s++;
  const next: Vec2[] = [];
  for (let i = 0; i <= poles.length; i++) {
    const prev = poles[i - 1];
    const here = poles[i];
    if (i <= s - p) next.push(here ?? [Number.NaN, Number.NaN]);
    else if (i > s) next.push(prev ?? [Number.NaN, Number.NaN]);
    else {
      const ki = knots[i] ?? Number.NaN;
      const alpha = (u - ki) / ((knots[i + p] ?? Number.NaN) - ki);
      const a = here ?? [Number.NaN, Number.NaN];
      const b = prev ?? [Number.NaN, Number.NaN];
      next.push([alpha * a[0] + (1 - alpha) * b[0], alpha * a[1] + (1 - alpha) * b[1]]);
    }
  }
  return { poles: next, knots: [...knots.slice(0, s + 1), u, ...knots.slice(s + 1)] };
}

// --- Helpers ----------------------------------------------------------------------------------

/** Every coordinate of a curve: its points, and the center of an arc or a circle. */
function coordinatesOf(c: ProfileCurve): readonly number[] {
  switch (c.kind) {
    case 'line':
      return [...c.from, ...c.to];
    case 'arc':
      return [...c.center, ...c.from, ...c.to];
    case 'circle':
      return [...c.center, c.center[0] + c.radius, c.center[1] + c.radius];
    case 'bspline':
      return c.poles.flat();
  }
}

/** The sweep of an arc in its own direction, (0, 2π). */
function arcSweep(c: Extract<ProfileCurve, { kind: 'arc' }>): number {
  const a0 = angleOf(sub(c.from, c.center));
  const a1 = angleOf(sub(c.to, c.center));
  return mod2pi(c.ccw ? a1 - a0 : a0 - a1);
}

function onCircle(center: Vec2, r: number, angle: number): Vec2 {
  return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
}

/** Spec 06: coordinates agree within POINT_TOLERANCE · max(1, |coordinate|). */
function samePoint(a: Vec2, b: Vec2): boolean {
  const near = (u: number, v: number): boolean =>
    Math.abs(u - v) <= POINT_TOLERANCE * Math.max(1, Math.abs(u), Math.abs(v));
  return near(a[0], b[0]) && near(a[1], b[1]);
}
