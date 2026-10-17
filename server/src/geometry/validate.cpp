#include "validate.hpp"

#include <algorithm>
#include <cmath>
#include <optional>
#include <set>
#include <string>

#include "failure.hpp"
#include "geom2d.hpp"

namespace tinycad::geometry::detail {

namespace {

/** Spec 06: the two radii of an arc agree within this, relative. */
constexpr double kRadiusTolerance = 1e-7;
/** Geom_BSplineCurve::MaxDegree(): OCCT refuses a higher degree. */
constexpr int kMaxSplineDegree = 25;
/** Spec 06: an arc radius must be larger than this. */
constexpr double kMinArcRadius = 1e-9;
/** curveSegment: a parameter this much · max(1, |bound|) outside the range is the bound. */
constexpr double kParamTolerance = 1e-9;

/** Whether the id is required and whether a curve of zero length is an error or left out. */
struct CurveRules {
  bool idRequired;
  bool skipZeroLength;
};

constexpr CurveRules kFaceCurve{false, false};
constexpr CurveRules kRegionCurve{true, true};
constexpr CurveRules kChainCurve{true, false};

/** The problems found by a check; `fail` throws them as one 'invalid-input'. */
class Problems {
 public:
  explicit Problems(std::string call) : call_(std::move(call)) {}

  void add(const std::string& problem) { list_.push_back(problem); }

  [[noreturn]] void fail() const {
    std::string text = call_ + ":";
    for (std::size_t i = 0; i < list_.size(); ++i) text += (i == 0 ? " " : "; ") + list_[i];
    throw Failure(ErrorCode::InvalidInput, text);
  }

  void failIfAny() const {
    if (!list_.empty()) fail();
  }

  [[noreturn]] void fail(const std::string& problem) {
    add(problem);
    fail();
  }

 private:
  std::string call_;
  std::vector<std::string> list_;
};

bool finite(Vec2 v) { return std::isfinite(v[0]) && std::isfinite(v[1]); }

/**
 * Why a knot vector of the right length is not clamped, or nullopt when it is: the first and
 * the last degree + 1 knots equal, first < last, the interior knots strictly between them,
 * non-decreasing and none repeated more than degree times.
 */
std::optional<std::string> knotsProblem(const std::vector<double>& knots, int degree) {
  const auto d = static_cast<std::size_t>(degree);
  const double first = knots.front();
  const double last = knots.back();
  for (std::size_t i = 0; i <= d; ++i) {
    if (knots[i] != first) return "knots must be clamped: the first degree + 1 must be equal";
  }
  for (std::size_t i = knots.size() - d - 1; i < knots.size(); ++i) {
    if (knots[i] != last) return "knots must be clamped: the last degree + 1 must be equal";
  }
  if (!(first < last)) return "the first knot must be smaller than the last one";
  const std::vector<double> interior(knots.begin() + static_cast<std::ptrdiff_t>(d + 1),
                                     knots.end() - static_cast<std::ptrdiff_t>(d + 1));
  for (double k : interior) {
    if (!(first < k && k < last)) {
      return "interior knots must lie strictly between the first and the last knot";
    }
  }
  for (std::size_t i = 1; i < interior.size(); ++i) {
    if (interior[i] < interior[i - 1]) return "knots must not decrease";
  }
  int run = 0;
  for (std::size_t i = 0; i < interior.size(); ++i) {
    run = i > 0 && interior[i] == interior[i - 1] ? run + 1 : 1;
    if (run > degree) return "an interior knot must not repeat more than degree times";
  }
  return std::nullopt;
}

enum class Read { Ok, Skip, Bad };

Read readLine(const Curve2& c, const std::string& path, Problems& problems, CurveRules rules) {
  if (!finite(c.from) || !finite(c.to)) {
    problems.add(path + ": from and to must be 2 finite numbers each");
    return Read::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return Read::Skip;
    problems.add(path + ": a line must not have zero length");
    return Read::Bad;
  }
  return Read::Ok;
}

Read readArc(const Curve2& c, const std::string& path, Problems& problems, CurveRules rules) {
  if (!finite(c.center) || !finite(c.from) || !finite(c.to)) {
    problems.add(path + ": center, from and to must be 2 finite numbers each");
    return Read::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return Read::Skip;
    problems.add(path + ": an arc must not have zero length");
    return Read::Bad;
  }
  const double r1 = dist(c.from, c.center);
  const double r2 = dist(c.to, c.center);
  if (!(std::abs(r1 - r2) <= kRadiusTolerance * std::max(r1, r2))) {
    problems.add(path + ": from and to must be equally far from center");
    return Read::Bad;
  }
  if (!(std::min(r1, r2) > kMinArcRadius)) {
    problems.add(path + ": the arc radius is too small");
    return Read::Bad;
  }
  return Read::Ok;
}

Read readCircle(const Curve2& c, const std::string& path, Problems& problems) {
  if (!finite(c.center)) {
    problems.add(path + ": center must be 2 finite numbers");
    return Read::Bad;
  }
  if (!std::isfinite(c.radius) || !(c.radius > 0)) {
    problems.add(path + ": radius must be finite and > 0");
    return Read::Bad;
  }
  return Read::Ok;
}

/** A B-spline checked so that Geom2d_BSplineCurve never throws on it (M29). */
Read readSpline(const Curve2& c, const std::string& path, Problems& problems, CurveRules rules) {
  if (c.degree < 1 || c.degree > kMaxSplineDegree) {
    problems.add(path + ": degree must be an integer from 1 to 25");
    return Read::Bad;
  }
  if (!std::all_of(c.poles.begin(), c.poles.end(), finite)) {
    problems.add(path + ": poles must be an array of 2 finite numbers each");
    return Read::Bad;
  }
  const auto degree = static_cast<std::size_t>(c.degree);
  if (c.poles.size() < degree + 1) {
    problems.add(path + ": a spline needs at least degree + 1 poles");
    return Read::Bad;
  }
  const bool knotsFinite =
      std::all_of(c.knots.begin(), c.knots.end(), [](double k) { return std::isfinite(k); });
  if (c.knots.size() != c.poles.size() + degree + 1 || !knotsFinite) {
    problems.add(path + ": knots must be poles + degree + 1 finite numbers");
    return Read::Bad;
  }
  if (const auto problem = knotsProblem(c.knots, c.degree)) {
    problems.add(path + ": " + *problem);
    return Read::Bad;
  }
  // Zero length: every pole in one point (the curve lies in the hull of its poles). Its ends
  // alone do not tell: a closed spline has both in one point.
  const bool onePoint = std::all_of(c.poles.begin(), c.poles.end(),
                                    [&](Vec2 q) { return samePoint(q, c.poles.front()); });
  if (rules.skipZeroLength && onePoint) return Read::Skip;
  return Read::Ok;
}

/** One curve against the rules; Skip for a curve of zero length the rules leave out. */
Read readCurve(const Curve2& c, const std::string& path, Problems& problems, CurveRules rules) {
  if (c.id.empty() && rules.idRequired) {
    problems.add(path + ": id must be a non-empty string");
    return Read::Bad;
  }
  switch (c.kind) {
    case Kind::Line:
      return readLine(c, path, problems, rules);
    case Kind::Arc:
      return readArc(c, path, problems, rules);
    case Kind::Circle:
      return readCircle(c, path, problems);
    case Kind::BSpline:
      break;
  }
  return readSpline(c, path, problems, rules);
}

std::string at(const std::string& name, std::size_t i) {
  return name + "[" + std::to_string(i) + "]";
}

/** The range of t (spec 12): a circle [0, 2π], an arc [0, sweep], a line [0, 1], a spline its knots. */
std::pair<double, double> paramRange(const Curve2& c) {
  switch (c.kind) {
    case Kind::Line:
      return {0, 1};
    case Kind::Circle:
      return {0, kTurn};
    case Kind::Arc:
      return {0, arcSweep(c)};
    case Kind::BSpline:
      break;
  }
  return {c.knots.front(), c.knots.back()};
}

/** `value` moved onto `bound` when it lies within kParamTolerance of it. */
double snapTo(double value, double bound) {
  return std::abs(value - bound) <= kParamTolerance * std::max(1.0, std::abs(bound)) ? bound
                                                                                      : value;
}

}  // namespace

std::vector<Curve2> checkIntersections(const std::vector<Curve2>& curves) {
  Problems problems("curveIntersections");
  std::vector<Curve2> checked;
  std::set<std::string> seen;
  for (std::size_t i = 0; i < curves.size(); ++i) {
    const std::string path = at("curves", i);
    const Curve2& curve = curves[i];
    // Unique among all curves, the skipped ones of zero length too.
    if (!curve.id.empty()) {
      if (seen.contains(curve.id)) problems.add(path + ": id " + curve.id + " is used twice");
      seen.insert(curve.id);
    }
    if (readCurve(curve, path, problems, kRegionCurve) == Read::Ok) checked.push_back(curve);
  }
  problems.failIfAny();
  return checked;
}

SegmentInput checkSegment(const Curve2& curve, double from, double to) {
  Problems problems("curveSegment");
  const Read read = readCurve(curve, "curve", problems, kFaceCurve);
  if (!std::isfinite(from)) problems.add("from must be finite");
  if (!std::isfinite(to)) problems.add("to must be finite");
  problems.failIfAny();
  if (read != Read::Ok) problems.fail("invalid input");
  if (!(from < to)) problems.fail("from must be smaller than to");
  const bool circle = curve.kind == Kind::Circle;
  const auto [low, high] = paramRange(curve);
  const double start = snapTo(from, low);
  // A circle may run past 2π, by less than one turn from `from`: a full turn would be an arc
  // with from = to, which makeFace and profileRegions take as zero length (spec 06).
  const double end = snapTo(to, circle ? start + kTurn : high);
  if (start < low || start >= (circle ? kTurn : high)) {
    problems.fail("from must lie in the range of the curve");
  }
  if (circle ? end >= start + kTurn : end > high) {
    problems.fail(circle ? "to must be less than one turn after from"
                         : "to must lie in the range of the curve");
  }
  return {curve, start, end};
}

void checkFillet(const Curve2& a, const Curve2& b, double radius, Vec2 near) {
  Problems problems("filletArc");
  if (readCurve(a, "a", problems, kFaceCurve) == Read::Ok && a.kind != Kind::Line &&
      a.kind != Kind::Arc) {
    problems.add("a must be a line or an arc");
  }
  if (readCurve(b, "b", problems, kFaceCurve) == Read::Ok && b.kind != Kind::Line &&
      b.kind != Kind::Arc) {
    problems.add("b must be a line or an arc");
  }
  if (!std::isfinite(radius) || !(radius > 0)) problems.add("radius must be finite and > 0");
  if (!finite(near)) problems.add("near must be 2 finite numbers");
  problems.failIfAny();
}

void checkOffset(const std::vector<Curve2>& chain, bool closed, double distance) {
  Problems problems("offsetCurves");
  if (!std::isfinite(distance) || distance == 0) problems.add("distance must be finite and not 0");
  if (chain.empty()) problems.fail("curves must not be empty");
  for (std::size_t i = 0; i < chain.size(); ++i) {
    readCurve(chain[i], at("curves", i), problems, kChainCurve);
  }
  problems.failIfAny();
  const bool hasCircle = std::any_of(chain.begin(), chain.end(),
                                     [](const Curve2& c) { return c.kind == Kind::Circle; });
  if (hasCircle) {
    if (chain.size() > 1) problems.fail("a circle must be the only curve of its chain");
    if (!closed) problems.fail("a circle is a closed chain");
    return;
  }
  const std::size_t joints = closed ? chain.size() : chain.size() - 1;
  for (std::size_t i = 0; i < joints; ++i) {
    if (!samePoint(endOf(chain[i]), startOf(chain[(i + 1) % chain.size()]))) {
      problems.fail(at("curves", i) + ": its end must lie on the start of the next curve");
    }
  }
}

}  // namespace tinycad::geometry::detail
