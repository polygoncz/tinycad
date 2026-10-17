#include "offset_chain.hpp"

#include <Geom2dAPI_PointsToBSpline.hxx>
#include <Geom2dAPI_ProjectPointOnCurve.hxx>
#include <GeomAbs_Shape.hxx>
#include <NCollection_Array1.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec2d.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>

#include "geom2d.hpp"

namespace tinycad::geometry::detail {

namespace {

/** Spec 06: a fitted spline keeps within this · the scale from the exact offset. */
constexpr double kSplineTolerance = 1e-4;
/** The samples of each spline piece start at this count and double while the fit is too far… */
constexpr int kFirstSamples = 16;
/** …up to this count; still too far, the offset fails. */
constexpr int kMaxSamples = 1024;

Piece reversed(const Piece& p) {
  Piece r = p;
  r.from = p.to;
  r.to = p.from;
  if (p.kind == Piece::Kind::Arc) r.ccw = !p.ccw;
  if (p.kind == Piece::Kind::Sampled) {
    r.sample = [sample = p.sample](int n) {
      std::vector<Vec2> points = sample(n);
      std::reverse(points.begin(), points.end());
      return points;
    };
  }
  return r;
}

/** A point in the middle of the piece and its direction there. */
std::pair<Vec2, Vec2> middleOf(const Piece& piece) {
  switch (piece.kind) {
    case Piece::Kind::Arc: {
      const double a0 = angleAround(piece.center, piece.from);
      const double a1 = angleAround(piece.center, piece.to);
      double sweep = wrap(piece.ccw ? a1 - a0 : a0 - a1, kTurn);
      if (sweep == 0) sweep = kTurn;
      const double angle = a0 + ((piece.ccw ? 1 : -1) * sweep) / 2;
      const double r = dist(piece.center, piece.from);
      const Vec2 m{piece.center[0] + r * std::cos(angle), piece.center[1] + r * std::sin(angle)};
      const double sense = piece.ccw ? 1 : -1;
      return {m, {-sense * std::sin(angle), sense * std::cos(angle)}};
    }
    case Piece::Kind::Sampled: {
      const std::vector<Vec2> points = piece.sample(8);
      if (points.size() < 6) throw offsetFailure("a piece without samples");
      const Vec2 before = points[3];
      const Vec2 after = points[5];
      return {points[4], {after[0] - before[0], after[1] - before[1]}};
    }
    default:
      return {{(piece.from[0] + piece.to[0]) / 2, (piece.from[1] + piece.to[1]) / 2},
              {piece.to[0] - piece.from[0], piece.to[1] - piece.from[1]}};
  }
}

/** The parameter of the point of the spline nearest `m`. */
double projectedParameter(const Curve2& spline, Vec2 m) {
  Geom2dAPI_ProjectPointOnCurve projection(gp_Pnt2d(m[0], m[1]), splineCurve(spline));
  if (projection.NbPoints() == 0) throw offsetFailure("a point does not project on the spline");
  return projection.LowerDistanceParameter();
}

Vec2 splineValue(const Curve2& spline, double u) {
  const gp_Pnt2d p = splineCurve(spline)->Value(u);
  return {p.X(), p.Y()};
}

/** The point of the input curve nearest `m` (a line and an arc by their carriers). */
Vec2 footOf(const Curve2& c, Vec2 m) {
  if (c.kind == Kind::Line) {
    const Vec2 d{c.to[0] - c.from[0], c.to[1] - c.from[1]};
    const double t =
        ((m[0] - c.from[0]) * d[0] + (m[1] - c.from[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
    return {c.from[0] + t * d[0], c.from[1] + t * d[1]};
  }
  if (c.kind == Kind::BSpline) return splineValue(c, projectedParameter(c, m));
  const double r = c.kind == Kind::Arc ? dist(c.center, c.from) : c.radius;
  const double away = dist(c.center, m);
  return {c.center[0] + ((m[0] - c.center[0]) * r) / away,
          c.center[1] + ((m[1] - c.center[1]) * r) / away};
}

/** The direction of the input curve at its point nearest `m`. */
Vec2 tangentOf(const Curve2& c, Vec2 m) {
  if (c.kind == Kind::Line) return {c.to[0] - c.from[0], c.to[1] - c.from[1]};
  if (c.kind == Kind::BSpline) {
    gp_Pnt2d p;
    gp_Vec2d v;
    splineCurve(c)->D1(projectedParameter(c, m), p, v);
    return {v.X(), v.Y()};
  }
  const double sense = c.kind == Kind::Arc && !c.ccw ? -1 : 1;
  return {-sense * (m[1] - c.center[1]), sense * (m[0] - c.center[0])};
}

/** A point in the middle of an offset curve (a spline at the middle of its knots). */
Vec2 middleOfCurve(const Curve2& c) {
  if (c.kind == Kind::BSpline) return splineValue(c, (c.knots.front() + c.knots.back()) / 2);
  Piece p;
  p.kind = c.kind == Kind::Line ? Piece::Kind::Line : Piece::Kind::Arc;
  p.center = c.center;
  p.from = c.from;
  p.to = c.to;
  p.ccw = c.ccw;
  return middleOf(p).first;
}

const Curve2* curveWithId(const std::vector<Curve2>& curves, const std::string& id) {
  if (id.empty()) return nullptr;
  const auto it =
      std::find_if(curves.begin(), curves.end(), [&](const Curve2& c) { return c.id == id; });
  return it == curves.end() ? nullptr : &*it;
}

/** The distance of `q` from the curve: its projections and both ends. */
double distanceTo(const Handle(Geom2d_BSplineCurve) & curve, Vec2 q) {
  const gp_Pnt2d p(q[0], q[1]);
  Geom2dAPI_ProjectPointOnCurve projection(p, curve);
  double best = std::numeric_limits<double>::infinity();
  for (int i = 1; i <= projection.NbPoints(); ++i) best = std::min(best, projection.Distance(i));
  for (double u : {curve->FirstParameter(), curve->LastParameter()}) {
    best = std::min(best, curve->Value(u).Distance(p));
  }
  return best;
}

/**
 * A cubic B-spline through the samples of the pieces (Geom2dAPI_PointsToBSpline, degree 3, C2),
 * with `from` and `to` as its end poles and its knots in [0, 1]. The samples double until the
 * curve keeps within `tol` of the points halfway between them.
 */
Curve2 fitted(const std::vector<const Piece*>& pieces, Vec2 from, Vec2 to, double tol) {
  for (int n = kFirstSamples; n <= kMaxSamples; n *= 2) {
    std::vector<Vec2> points;
    std::vector<Vec2> halfway;
    for (std::size_t i = 0; i < pieces.size(); ++i) {
      const std::vector<Vec2> samples = pieces[i]->sample(n);
      points.insert(points.end(), samples.begin() + (i == 0 ? 0 : 1), samples.end());
      const std::vector<Vec2> fine = pieces[i]->sample(2 * n);
      for (std::size_t k = 1; k < fine.size(); k += 2) halfway.push_back(fine[k]);
    }
    NCollection_Array1<gp_Pnt2d> array(1, static_cast<int>(points.size()));
    for (std::size_t k = 0; k < points.size(); ++k) {
      array.SetValue(static_cast<int>(k) + 1, gp_Pnt2d(points[k][0], points[k][1]));
    }
    Geom2dAPI_PointsToBSpline fit;
    fit.Init(array, 3, 3, GeomAbs_C2, tol / 2);
    if (!fit.IsDone()) continue;
    const Handle(Geom2d_BSplineCurve) curve = fit.Curve();
    if (curve->Degree() != 3) {
      throw offsetFailure("the fitted spline is not cubic: " + std::to_string(curve->Degree()));
    }
    const bool close = std::all_of(halfway.begin(), halfway.end(),
                                   [&](Vec2 q) { return distanceTo(curve, q) <= tol; });
    if (!close) continue;
    const NCollection_Array1<double>& knots = curve->Knots();
    Curve2 out = splineOf(curve, knots.Value(knots.Lower()), knots.Value(knots.Upper()));
    out.poles.front() = from;
    out.poles.back() = to;
    return out;
  }
  throw offsetFailure("the offset of a spline does not fit a cubic B-spline");
}

}  // namespace

Failure offsetFailure(const std::string& reason) {
  return {ErrorCode::OperationFailed, "offsetCurves: " + reason};
}

std::vector<Piece> chained(std::vector<Piece> pieces, bool closed, double tol) {
  std::vector<Piece>& left = pieces;
  const auto touches = [&](Vec2 p, std::size_t self) {
    for (std::size_t k = 0; k < left.size(); ++k) {
      if (k != self && (dist(p, left[k].from) <= tol || dist(p, left[k].to) <= tol)) return true;
    }
    return false;
  };
  std::optional<Piece> first;
  if (!closed) {
    for (std::size_t i = 0; i < left.size(); ++i) {
      if (!touches(left[i].from, i)) first = left[i];
      else if (!touches(left[i].to, i)) first = reversed(left[i]);
      if (first) {
        left.erase(left.begin() + static_cast<std::ptrdiff_t>(i));
        break;
      }
    }
  }
  if (!first) {
    if (left.empty()) throw offsetFailure("nothing is left of the chain");
    first = left.front();
    left.erase(left.begin());
  }
  std::vector<Piece> chain{*first};
  for (;;) {
    const Vec2 tail = chain.back().to;
    const auto next = std::find_if(left.begin(), left.end(), [&](const Piece& q) {
      return dist(tail, q.from) <= tol || dist(tail, q.to) <= tol;
    });
    if (next == left.end()) break;
    const Piece q = *next;
    left.erase(next);
    chain.push_back(dist(tail, q.from) <= tol ? q : reversed(q));
  }
  if (!left.empty()) throw offsetFailure("the offset is not one chain");
  if (closed && dist(chain.back().to, chain.front().from) > tol) {
    throw offsetFailure("the offset of a closed chain is open");
  }
  return chain;
}

std::vector<Piece> alongInput(const std::vector<Piece>& chain, const std::vector<Curve2>& curves) {
  for (const Piece& piece : chain) {
    const Curve2* curve = curveWithId(curves, piece.source);
    if (curve == nullptr) continue;
    const auto [m, tangent] = middleOf(piece);
    const Vec2 along = tangentOf(*curve, m);
    if (along[0] * tangent[0] + along[1] * tangent[1] >= 0) return chain;
    std::vector<Piece> back;
    for (auto it = chain.rbegin(); it != chain.rend(); ++it) back.push_back(reversed(*it));
    return back;
  }
  return chain;
}

std::vector<Piece> fromFirst(const std::vector<Piece>& chain, const std::vector<Curve2>& curves) {
  const auto rank = [&](const Piece& p) {
    const auto it = std::find_if(curves.begin(), curves.end(),
                                 [&](const Curve2& c) { return c.id == p.source; });
    return static_cast<std::size_t>(it - curves.begin());
  };
  const std::size_t n = chain.size();
  std::optional<std::size_t> start;
  for (std::size_t i = 0; i < n; ++i) {
    const bool opens = chain[(i + n - 1) % n].source != chain[i].source;
    if (opens && (!start || rank(chain[i]) < rank(chain[*start]))) start = i;
  }
  // No piece opens a curve: the whole chain is the offset of one closed spline.
  const std::size_t s = start.value_or(0);
  std::vector<Piece> out(chain.begin() + static_cast<std::ptrdiff_t>(s), chain.end());
  out.insert(out.end(), chain.begin(), chain.begin() + static_cast<std::ptrdiff_t>(s));
  return out;
}

std::vector<OffsetCurve> curvesOf(const std::vector<Piece>& chain, bool closed, double scale) {
  std::vector<std::vector<const Piece*>> groups;
  for (const Piece& p : chain) {
    const Piece* previous = groups.empty() ? nullptr : groups.back().back();
    if (previous != nullptr && p.kind == Piece::Kind::Sampled &&
        previous->kind == Piece::Kind::Sampled && !p.source.empty() &&
        previous->source == p.source) {
      groups.back().push_back(&p);
    } else {
      groups.push_back({&p});
    }
  }
  std::vector<OffsetCurve> out;
  for (std::size_t i = 0; i < groups.size(); ++i) {
    const Piece& head = *groups[i].front();
    std::optional<Vec2> previous;
    if (i > 0) previous = groups[i - 1].back()->to;
    else if (closed) previous = groups.back().back()->to;
    const Vec2 from = previous.value_or(head.from);
    const Vec2 to = groups[i].back()->to;
    switch (head.kind) {
      case Piece::Kind::Line:
        out.push_back({Curve2::line(from, to), head.source});
        break;
      case Piece::Kind::Arc:
        out.push_back({Curve2::arc(head.center, from, to, head.ccw), head.source});
        break;
      case Piece::Kind::Sampled:
        out.push_back({fitted(groups[i], from, to, kSplineTolerance * scale), head.source});
        break;
      case Piece::Kind::Circle:
        throw offsetFailure("a circle inside a chain");
    }
  }
  return out;
}

bool onRight(const std::vector<OffsetCurve>& result, const std::vector<Curve2>& curves) {
  for (const OffsetCurve& r : result) {
    const Curve2* curve = curveWithId(curves, r.source);
    if (curve == nullptr || r.curve.kind == Kind::Circle) continue;
    const Vec2 m = middleOfCurve(r.curve);
    const Vec2 foot = footOf(*curve, m);
    const Vec2 t = tangentOf(*curve, foot);
    return t[0] * (m[1] - foot[1]) - t[1] * (m[0] - foot[0]) < 0;
  }
  throw offsetFailure("the offset has no curve from the chain");
}

}  // namespace tinycad::geometry::detail
