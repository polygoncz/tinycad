#include "bspline.hpp"

#include <algorithm>
#include <cstddef>
#include <vector>

#include "tinycad/core/result.hpp"

namespace tinycad::solver_planegcs::bspline {

namespace {

using core::BSplineShape;
using core::Vec2;
using Matrix = std::vector<std::vector<double>>;

/** A malformed shape is a programming error: the data were checked by Sketch::parse. */
void checkShape(const BSplineShape& curve) {
  TINYCAD_ASSERT(curve.degree >= 1 && static_cast<int>(curve.poles.size()) > curve.degree &&
                     curve.knots.size() == curve.poles.size() + curve.degree + 1,
                 "bspline: malformed shape");
}

/**
 * The knot span index i with knots[i] <= t < knots[i + 1] for `count` poles (A2.1); the last span
 * for t at the end of the range.
 */
int findSpan(const std::vector<double>& knots, int degree, int count, double t) {
  const int last = count - 1;
  if (t >= knots.at(last + 1)) {
    // At the end: the last non-empty span, so the curve ends exactly in the last pole.
    int i = last;
    while (i > degree && knots.at(i) >= knots.at(last + 1)) i--;
    return i;
  }
  int low = degree;
  int high = last + 1;
  while (high - low > 1) {
    const int mid = (low + high) / 2;
    if (t < knots.at(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return low;
}

/**
 * Non-zero basis functions N_span−p..span,p and their derivatives up to `order` at t (A2.3). Row
 * k holds the k-th derivatives; rows above the degree are zero.
 */
Matrix basisDerivatives(const std::vector<double>& knots, int degree, int span, double t,
                        int order) {
  const int p = degree;
  const auto size = static_cast<std::size_t>(p + 1);
  Matrix ndu(size, std::vector<double>(size, 0));
  std::vector<double> left(size, 0);
  std::vector<double> right(size, 0);
  ndu.at(0).at(0) = 1;
  for (int j = 1; j <= p; j++) {
    left.at(j) = t - knots.at(span + 1 - j);
    right.at(j) = knots.at(span + j) - t;
    double saved = 0;
    for (int r = 0; r < j; r++) {
      // Lower triangle: knot differences; upper triangle: basis functions.
      const double diff = right.at(r + 1) + left.at(j - r);
      ndu.at(j).at(r) = diff;
      const double temp = ndu.at(r).at(j - 1) / diff;
      ndu.at(r).at(j) = saved + right.at(r + 1) * temp;
      saved = left.at(j - r) * temp;
    }
    ndu.at(j).at(j) = saved;
  }

  Matrix ders(static_cast<std::size_t>(order + 1), std::vector<double>(size, 0));
  for (int j = 0; j <= p; j++) ders.at(0).at(j) = ndu.at(j).at(p);
  const int kmax = std::min(order, p);
  for (int r = 0; r <= p; r++) {
    Matrix a(2, std::vector<double>(size, 0));
    int s1 = 0;
    int s2 = 1;
    a.at(0).at(0) = 1;
    for (int k = 1; k <= kmax; k++) {
      double d = 0;
      const int rk = r - k;
      const int pk = p - k;
      if (r >= k) {
        a.at(s2).at(0) = a.at(s1).at(0) / ndu.at(pk + 1).at(rk);
        d = a.at(s2).at(0) * ndu.at(rk).at(pk);
      }
      const int j1 = rk >= -1 ? 1 : -rk;
      const int j2 = r - 1 <= pk ? k - 1 : p - r;
      for (int j = j1; j <= j2; j++) {
        a.at(s2).at(j) = (a.at(s1).at(j) - a.at(s1).at(j - 1)) / ndu.at(pk + 1).at(rk + j);
        d += a.at(s2).at(j) * ndu.at(rk + j).at(pk);
      }
      if (r <= pk) {
        a.at(s2).at(k) = -a.at(s1).at(k - 1) / ndu.at(pk + 1).at(r);
        d += a.at(s2).at(k) * ndu.at(r).at(pk);
      }
      ders.at(k).at(r) = d;
      std::swap(s1, s2);
    }
  }
  double factor = p;
  for (int k = 1; k <= kmax; k++) {
    for (int j = 0; j <= p; j++) ders.at(k).at(j) *= factor;
    factor *= p - k;
  }
  return ders;
}

/** The point and its derivatives up to `order` at t (A3.2). */
std::vector<Vec2> derivatives(const BSplineShape& curve, double t, int order) {
  checkShape(curve);
  const int n = static_cast<int>(curve.poles.size());
  const double u = std::min(std::max(t, curve.knots.at(curve.degree)), curve.knots.at(n));
  const int span = findSpan(curve.knots, curve.degree, n, u);
  const Matrix ders = basisDerivatives(curve.knots, curve.degree, span, u, order);
  std::vector<Vec2> out;
  for (const auto& row : ders) {
    double x = 0;
    double y = 0;
    for (int j = 0; j <= curve.degree; j++) {
      const Vec2& p = curve.poles.at(span - curve.degree + j);
      const double w = row.at(j);
      x += w * p[0];
      y += w * p[1];
    }
    out.push_back({x, y});
  }
  return out;
}

}  // namespace

Vec2 evaluate(const BSplineShape& curve, double t) { return derivatives(curve, t, 0).at(0); }

Vec2 derivative(const BSplineShape& curve, double t, int order) {
  if (curve.degree < order) return {0, 0};
  return derivatives(curve, t, order).at(order);
}

}  // namespace tinycad::solver_planegcs::bspline
