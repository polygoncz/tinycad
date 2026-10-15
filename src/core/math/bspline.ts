import { assert } from '../assert';
import type { Vec2 } from './plane';

// Polynomial B-spline math (spec 02-core, spec 12 "Spliny (M29)", Q086, Q087): evaluation,
// derivatives, tessellation and global interpolation (Piegl–Tiller, The NURBS Book). In core
// because sketch and the FakeKernel need it both. No gl-matrix here.

/** A clamped polynomial B-spline. Structurally a subset of the Curve2 and ProfileCurve `bspline` variants. */
export interface BSplineShape {
  readonly degree: number;
  readonly poles: readonly Vec2[];
  readonly knots: readonly number[];
}

/** The point on the curve (de Boor); t is clamped to [knots[degree], knots[poles.length]]. */
function evaluate(curve: BSplineShape, t: number): Vec2 {
  return at(derivatives(curve, t, 0), 0);
}

/** The order-th derivative with respect to t (order 1 or 2; a zero vector when degree < order). */
function derivative(curve: BSplineShape, t: number, order: 1 | 2 = 1): Vec2 {
  if (curve.degree < order) return [0, 0];
  return at(derivatives(curve, t, order), order);
}

/** Hard limit on halving per knot span, so a zero or tiny tolerance still terminates. */
const MAX_DEPTH = 16;
/** Halvings always done in a curved knot span, so an S-shaped span with its middle on the chord is not missed. */
const MIN_DEPTH = 2;

/**
 * Curve points from t = 0 to 1: adaptive halving while the middle of a segment deviates from its
 * chord by more than the tolerance; both ends exactly (= the end poles). Each span between distinct
 * knots is halved separately, so a short arc is not skipped.
 */
function tessellate(curve: BSplineShape, tolerance: number): Vec2[] {
  checkShape(curve);
  const { degree, poles, knots } = curve;
  const first = poles[0];
  const last = poles[poles.length - 1];
  assert(first !== undefined && last !== undefined, 'bspline.tessellate: a spline needs poles');
  const minDepth = degree > 1 ? MIN_DEPTH : 0;
  const out: Vec2[] = [first];

  const halve = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
    const m = (a + b) / 2;
    const pm = evaluate(curve, m);
    if (depth < MAX_DEPTH && (depth < minDepth || distanceToChord(pm, pa, pb) > tolerance)) {
      halve(a, pa, m, pm, depth + 1);
      halve(m, pm, b, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };

  const end = poles.length;
  let a = knotAt(knots, degree);
  let pa = first;
  for (let i = degree + 1; i <= end; i++) {
    const b = knotAt(knots, i);
    if (b <= a) continue;
    const pb = i === end ? last : evaluate(curve, b);
    halve(a, pa, b, pb, 0);
    a = b;
    pa = pb;
  }
  return out;
}

/**
 * Global interpolation (Piegl–Tiller 9.2.1): degree = min(3, n − 1), params from chord lengths,
 * knots by averaging. Throws RangeError for fewer than 2 points, a non-finite coordinate or two
 * consecutive equal points.
 */
function interpolate(points: readonly Vec2[]): {
  degree: 1 | 2 | 3;
  params: number[];
  knots: number[];
  poles: Vec2[];
} {
  const n = points.length;
  if (n < 2) throw new RangeError(`bspline.interpolate: needs at least 2 points, got ${String(n)}`);
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`bspline.interpolate: non-finite point [${String(x)}, ${String(y)}]`);
    }
  }
  const degree: 1 | 2 | 3 = n === 2 ? 1 : n === 3 ? 2 : 3;

  // Params from chord lengths (Piegl–Tiller eq. 9.5), normalised to 0..1.
  const chords: number[] = [];
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(
      at(points, i)[0] - at(points, i - 1)[0],
      at(points, i)[1] - at(points, i - 1)[1],
    );
    if (d === 0)
      throw new RangeError(
        `bspline.interpolate: points ${String(i - 1)} and ${String(i)} are equal`,
      );
    chords.push(d);
  }
  const total = chords.reduce((s, d) => s + d, 0);
  const params: number[] = [0];
  let run = 0;
  for (let i = 1; i < n - 1; i++) {
    run += at(chords, i - 1);
    params.push(run / total);
  }
  params.push(1);

  // Knots by averaging (Piegl–Tiller eq. 9.8).
  const knots: number[] = Array<number>(degree + 1).fill(0);
  for (let j = 1; j <= n - 1 - degree; j++) {
    let s = 0;
    for (let i = j; i < j + degree; i++) s += at(params, i);
    knots.push(s / degree);
  }
  for (let i = 0; i <= degree; i++) knots.push(1);

  // Collocation matrix N[k][i] = N_i,p(t_k); the system N · P = Q gives the poles.
  const matrix: number[][] = params.map((t) => {
    const row: number[] = Array<number>(n).fill(0);
    const span = findSpan(knots, degree, n, t);
    const basis = at(basisDerivatives(knots, degree, span, t, 0), 0);
    for (let j = 0; j <= degree; j++) row[span - degree + j] = at(basis, j);
    return row;
  });
  const poles = solve(matrix, points);
  return { degree, params, knots, poles };
}

export const bspline = { evaluate, derivative, tessellate, interpolate };

/** Points and its derivatives up to `order` at t (Piegl–Tiller A3.2). */
function derivatives(curve: BSplineShape, t: number, order: number): Vec2[] {
  checkShape(curve);
  const { degree, poles, knots } = curve;
  const n = poles.length;
  const u = Math.min(Math.max(t, knotAt(knots, degree)), knotAt(knots, n));
  const span = findSpan(knots, degree, n, u);
  const ders = basisDerivatives(knots, degree, span, u, order);
  return ders.map((row): Vec2 => {
    let x = 0;
    let y = 0;
    for (let j = 0; j <= degree; j++) {
      const p = at(poles, span - degree + j);
      const w = at(row, j);
      x += w * p[0];
      y += w * p[1];
    }
    return [x, y];
  });
}

/**
 * The knot span index i with knots[i] <= t < knots[i + 1] for `count` poles (Piegl–Tiller A2.1);
 * the last span for t at the end of the range.
 */
function findSpan(knots: readonly number[], degree: number, count: number, t: number): number {
  const last = count - 1;
  if (t >= knotAt(knots, last + 1)) {
    // At the end: the last non-empty span, so the curve ends exactly in the last pole.
    let i = last;
    while (i > degree && knotAt(knots, i) >= knotAt(knots, last + 1)) i--;
    return i;
  }
  let low = degree;
  let high = last + 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (t < knotAt(knots, mid)) high = mid;
    else low = mid;
  }
  return low;
}

/**
 * Non-zero basis functions N_span−p..span,p and their derivatives up to `order` at t
 * (Piegl–Tiller A2.3). Row k holds the k-th derivatives; rows above the degree are zero.
 */
function basisDerivatives(
  knots: readonly number[],
  degree: number,
  span: number,
  t: number,
  order: number,
): number[][] {
  const p = degree;
  const ndu: number[][] = Array.from({ length: p + 1 }, () => Array<number>(p + 1).fill(0));
  const left: number[] = Array<number>(p + 1).fill(0);
  const right: number[] = Array<number>(p + 1).fill(0);
  setAt(ndu, 0, 0, 1);
  for (let j = 1; j <= p; j++) {
    left[j] = t - knotAt(knots, span + 1 - j);
    right[j] = knotAt(knots, span + j) - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      // Lower triangle: knot differences; upper triangle: basis functions.
      const diff = at(right, r + 1) + at(left, j - r);
      setAt(ndu, j, r, diff);
      const temp = getAt(ndu, r, j - 1) / diff;
      setAt(ndu, r, j, saved + at(right, r + 1) * temp);
      saved = at(left, j - r) * temp;
    }
    setAt(ndu, j, j, saved);
  }

  const ders: number[][] = Array.from({ length: order + 1 }, () => Array<number>(p + 1).fill(0));
  for (let j = 0; j <= p; j++) setAt(ders, 0, j, getAt(ndu, j, p));
  const kmax = Math.min(order, p);
  for (let r = 0; r <= p; r++) {
    const a: number[][] = [Array<number>(p + 1).fill(0), Array<number>(p + 1).fill(0)];
    let s1 = 0;
    let s2 = 1;
    setAt(a, 0, 0, 1);
    for (let k = 1; k <= kmax; k++) {
      let d = 0;
      const rk = r - k;
      const pk = p - k;
      if (r >= k) {
        setAt(a, s2, 0, getAt(a, s1, 0) / getAt(ndu, pk + 1, rk));
        d = getAt(a, s2, 0) * getAt(ndu, rk, pk);
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        setAt(a, s2, j, (getAt(a, s1, j) - getAt(a, s1, j - 1)) / getAt(ndu, pk + 1, rk + j));
        d += getAt(a, s2, j) * getAt(ndu, rk + j, pk);
      }
      if (r <= pk) {
        setAt(a, s2, k, -getAt(a, s1, k - 1) / getAt(ndu, pk + 1, r));
        d += getAt(a, s2, k) * getAt(ndu, r, pk);
      }
      setAt(ders, k, r, d);
      [s1, s2] = [s2, s1];
    }
  }
  let factor = p;
  for (let k = 1; k <= kmax; k++) {
    for (let j = 0; j <= p; j++) setAt(ders, k, j, getAt(ders, k, j) * factor);
    factor *= p - k;
  }
  return ders;
}

/** Solves A · X = B for two right-hand columns (Gauss with partial pivoting). */
function solve(matrix: readonly (readonly number[])[], rhs: readonly Vec2[]): Vec2[] {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]);
  const b = rhs.map((p) => [p[0], p[1]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(getAt(a, r, col)) > Math.abs(getAt(a, pivot, col))) pivot = r;
    }
    assert(getAt(a, pivot, col) !== 0, 'bspline.interpolate: singular collocation matrix');
    [a[col], a[pivot]] = [at(a, pivot), at(a, col)];
    [b[col], b[pivot]] = [at(b, pivot), at(b, col)];
    for (let r = col + 1; r < n; r++) {
      const f = getAt(a, r, col) / getAt(a, col, col);
      if (f === 0) continue;
      for (let c = col; c < n; c++) setAt(a, r, c, getAt(a, r, c) - f * getAt(a, col, c));
      setAt(b, r, 0, getAt(b, r, 0) - f * getAt(b, col, 0));
      setAt(b, r, 1, getAt(b, r, 1) - f * getAt(b, col, 1));
    }
  }
  const x: Vec2[] = Array<Vec2>(n);
  for (let r = n - 1; r >= 0; r--) {
    let sx = getAt(b, r, 0);
    let sy = getAt(b, r, 1);
    for (let c = r + 1; c < n; c++) {
      const xc = at(x, c);
      sx -= getAt(a, r, c) * xc[0];
      sy -= getAt(a, r, c) * xc[1];
    }
    const d = getAt(a, r, r);
    x[r] = [sx / d, sy / d];
  }
  return x;
}

function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
}

/** A malformed shape is a programming error: the data were checked by parseSketchData. */
function checkShape(curve: BSplineShape): void {
  assert(
    curve.degree >= 1 &&
      curve.poles.length > curve.degree &&
      curve.knots.length === curve.poles.length + curve.degree + 1,
    `bspline: malformed shape (degree ${String(curve.degree)}, ${String(curve.poles.length)} poles, ${String(curve.knots.length)} knots)`,
  );
}

function knotAt(knots: readonly number[], i: number): number {
  return at(knots, i);
}

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  // No assert(): its message would be built on every call in the hot loops.
  if (x === undefined) throw new Error(`bspline: index ${String(i)} out of range`);
  return x;
}

function getAt(m: readonly (readonly number[])[], r: number, c: number): number {
  return at(at(m, r), c);
}

function setAt(m: number[][], r: number, c: number, v: number): void {
  at(m, r)[c] = v;
}
