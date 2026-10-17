// curveIntersections (port of src/kernel-occt/curves.ts, spec 06 "Stav po M33"): intersections
// from Geom2dAPI_InterCurveCurve over the pairs whose bounding boxes overlap and over each
// spline with itself; it gives no parameters, so Geom2dAPI_ProjectPointOnCurve finds them,
// converted to t of spec 12.

#include <Geom2dAPI_InterCurveCurve.hxx>
#include <Geom2dAPI_ProjectPointOnCurve.hxx>
#include <gp_Pnt2d.hxx>

#include <algorithm>
#include <cmath>
#include <limits>

#include "algorithms.hpp"
#include "geom2d.hpp"
#include "touching.hpp"

namespace tinycad::geometry::detail {

namespace {

/**
 * A spline passes through its own intersection point at every parameter whose projection is
 * nearer than this many tolerances (near tangencies lose precision).
 */
constexpr double kSelfMatchFactor = 1e3;
/** Two parameters of a self-intersection closer than this part of the range are one. */
constexpr double kSelfParamGap = 1e-6;

/** A curve of the call with its OCCT curve (an arc built counter-clockwise). */
struct Entry {
  Curve2 curve;
  Handle(Geom2d_Curve) g;
};

/** A common point found for a pair, with the parameters t (spec 12) on both curves. */
struct Hit {
  Vec2 point;
  double ta;
  double tb;
  bool overlap;
};

struct Candidate {
  double u;
  double d;
};

/** Parameters of `g` near `p` with their distance: the projections and both ends. */
std::vector<Candidate> candidates(const Handle(Geom2d_Curve) & g, const gp_Pnt2d& p) {
  std::vector<Candidate> found;
  Geom2dAPI_ProjectPointOnCurve projection(p, g);
  for (int i = 1; i <= projection.NbPoints(); ++i) {
    found.push_back({projection.Parameter(i), projection.Distance(i)});
  }
  for (double u : {g->FirstParameter(), g->LastParameter()}) {
    found.push_back({u, g->Value(u).Distance(p)});
  }
  return found;
}

/** The parameter of `g` nearest to `p`: the orthogonal projections and both ends. */
double nearestParam(const Handle(Geom2d_Curve) & g, const gp_Pnt2d& p) {
  Candidate best{g->FirstParameter(), std::numeric_limits<double>::infinity()};
  for (const Candidate& c : candidates(g, p)) {
    if (c.d < best.d) best = c;
  }
  return best.u;
}

/** All parameters of `g` passing within `within` of `p`, ascending, without near duplicates. */
std::vector<double> paramsThrough(const Handle(Geom2d_Curve) & g, const gp_Pnt2d& p,
                                  double within) {
  const double range = g->LastParameter() - g->FirstParameter();
  std::vector<double> params;
  for (const Candidate& c : candidates(g, p)) {
    if (c.d <= within) params.push_back(c.u);
  }
  std::stable_sort(params.begin(), params.end());
  std::vector<double> out;
  for (std::size_t i = 0; i < params.size(); ++i) {
    if (i == 0 || params[i] - params[i - 1] > kSelfParamGap * range) out.push_back(params[i]);
  }
  return out;
}

/**
 * The parameter t of spec 12 from the parameter u of the OCCT curve: a line scaled to [0, 1];
 * an arc (built counter-clockwise) the angle from its `from`; a circle the angle in [0, 2π);
 * a spline u itself.
 */
double paramOf(const Entry& e, double u) {
  const double first = e.g->FirstParameter();
  const double last = e.g->LastParameter();
  const double clamped = std::min(std::max(u, first), last);
  switch (e.curve.kind) {
    case Kind::Line:
      return (clamped - first) / (last - first);
    case Kind::Arc:
      return e.curve.ccw ? clamped - first : last - clamped;
    case Kind::Circle: {
      const double t = wrap(u, kTurn);
      return t >= kTurn ? 0 : t;
    }
    case Kind::BSpline:
      break;
  }
  return clamped;
}

/** Points of two different curves: crossing points, and both ends of each shared piece. */
std::vector<Hit> pairHits(const Entry& a, const Entry& b, double tol) {
  Geom2dAPI_InterCurveCurve inter(a.g, b.g, tol);
  struct Point {
    Vec2 point;
    bool overlap;
  };
  std::vector<Point> points;
  for (int k = 1; k <= inter.NbPoints(); ++k) {
    const gp_Pnt2d p = inter.Point(k);
    points.push_back({{p.X(), p.Y()}, false});
  }
  for (int k = 1; k <= inter.NbSegments(); ++k) {
    // The piece on the first curve; its ends are the ends of the shared piece.
    Handle(Geom2d_Curve) piece;
    Handle(Geom2d_Curve) onOther;
    inter.Segment(k, piece, onOther);
    if (!sharesPiece(piece, b.g, tol)) {
      // A tangency: the curves stay within the tolerance near the touching point only.
      points.push_back({touchingPoint(piece, b.g), false});
      continue;
    }
    const gp_Pnt2d start = piece->Value(piece->FirstParameter());
    const gp_Pnt2d end = piece->Value(piece->LastParameter());
    points.push_back({{start.X(), start.Y()}, true});
    points.push_back({{end.X(), end.Y()}, true});
  }
  std::vector<Hit> hits;
  for (const Point& pt : points) {
    const gp_Pnt2d p(pt.point[0], pt.point[1]);
    hits.push_back(
        {pt.point, paramOf(a, nearestParam(a.g, p)), paramOf(b, nearestParam(b.g, p)), pt.overlap});
  }
  return hits;
}

/**
 * A spline crossing itself: each point of Geom2dAPI_InterCurveCurve with every pair of distinct
 * parameters through it. Pieces running over themselves are not reported.
 */
std::vector<Hit> selfHits(const Entry& e, double tol) {
  Geom2dAPI_InterCurveCurve inter(e.g, tol);
  std::vector<Hit> hits;
  for (int k = 1; k <= inter.NbPoints(); ++k) {
    const gp_Pnt2d p = inter.Point(k);
    const std::vector<double> params = paramsThrough(e.g, p, kSelfMatchFactor * tol);
    for (std::size_t i = 0; i < params.size(); ++i) {
      for (std::size_t j = i + 1; j < params.size(); ++j) {
        hits.push_back({{p.X(), p.Y()}, params[i], params[j], false});
      }
    }
  }
  return hits;
}

/** The hits of a pair: points merged within the contract tolerance (an overlap end wins), by ta. */
std::vector<CurveHit> finish(const Entry& a, const Entry& b, const std::vector<Hit>& hits) {
  std::vector<Hit> merged;
  for (const Hit& h : hits) {
    const auto same = std::find_if(merged.begin(), merged.end(),
                                   [&](const Hit& m) { return samePoint(m.point, h.point); });
    if (same == merged.end()) merged.push_back(h);
    else if (h.overlap) same->overlap = true;
  }
  std::vector<CurveHit> out;
  for (const Hit& h : merged) {
    out.push_back({a.curve.id, b.curve.id, h.point, h.ta, h.tb, h.overlap});
  }
  std::stable_sort(out.begin(), out.end(),
                   [](const CurveHit& x, const CurveHit& y) { return x.ta < y.ta; });
  return out;
}

}  // namespace

std::vector<CurveHit> intersectionsOf(const std::vector<Curve2>& curves) {
  const double tol = kConfusion * scaleOf(curves);

  std::vector<Entry> entries;
  for (const Curve2& curve : curves) {
    const Curve2 ccw = counterClockwise(curve);
    entries.push_back({curve, ccw.kind == Kind::Circle ? circleCurve(ccw.center, ccw.radius)
                                                       : boundedCurve(ccw)});
  }
  std::vector<std::vector<CurveHit>> out(entries.size());
  for (std::size_t i = 0; i < entries.size(); ++i) {
    if (entries[i].curve.kind == Kind::BSpline) {
      const auto found = finish(entries[i], entries[i], selfHits(entries[i], tol));
      out[i].insert(out[i].end(), found.begin(), found.end());
    }
  }
  std::vector<Box> boxes;
  for (const Curve2& c : curves) boxes.push_back(boxOf(c, tol));
  auto pairs = overlappingPairs(boxes);
  std::sort(pairs.begin(), pairs.end());
  for (const auto& [i, j] : pairs) {
    const auto found = finish(entries[i], entries[j], pairHits(entries[i], entries[j], tol));
    out[i].insert(out[i].end(), found.begin(), found.end());
  }
  std::vector<CurveHit> flat;
  for (const auto& list : out) flat.insert(flat.end(), list.begin(), list.end());
  return flat;
}

}  // namespace tinycad::geometry::detail
