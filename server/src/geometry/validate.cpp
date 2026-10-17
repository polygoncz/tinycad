#include "validate.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>

#include "tinycad/occt2d/curve_checks.hpp"

#include "failure.hpp"

namespace tinycad::geometry::detail {

using occt2d::arcSweep;
using occt2d::CurveRead;
using occt2d::CurveRules;
using occt2d::endOf;
using occt2d::Kind;
using occt2d::kTurn;
using occt2d::samePoint;
using occt2d::startOf;

namespace {

/** curveSegment: a parameter this much · max(1, |bound|) outside the range is the bound. */
constexpr double kParamTolerance = 1e-9;

constexpr CurveRules kFaceCurve{false, false};
constexpr CurveRules kRegionCurve{true, true};
constexpr CurveRules kChainCurve{true, false};

/** The problems found by a check; `fail` throws them as one 'invalid-input'. */
class Problems {
 public:
  explicit Problems(std::string call) : call_(std::move(call)) {}

  void add(const std::string& problem) { list_.push_back(problem); }

  /** The list itself, for occt2d::readCurve to append to. */
  std::vector<std::string>& list() { return list_; }

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

/** One curve against the rules by occt2d::readCurve (shared with tinycad_kernel). */
CurveRead readCurve(const Curve2& c, const std::string& path, Problems& problems,
                    CurveRules rules) {
  return occt2d::readCurve(c, path, problems.list(), rules);
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
    if (readCurve(curve, path, problems, kRegionCurve) == CurveRead::Ok) checked.push_back(curve);
  }
  problems.failIfAny();
  return checked;
}

SegmentInput checkSegment(const Curve2& curve, double from, double to) {
  Problems problems("curveSegment");
  const CurveRead read = readCurve(curve, "curve", problems, kFaceCurve);
  if (!std::isfinite(from)) problems.add("from must be finite");
  if (!std::isfinite(to)) problems.add("to must be finite");
  problems.failIfAny();
  if (read != CurveRead::Ok) problems.fail("invalid input");
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
  if (readCurve(a, "a", problems, kFaceCurve) == CurveRead::Ok && a.kind != Kind::Line &&
      a.kind != Kind::Arc) {
    problems.add("a must be a line or an arc");
  }
  if (readCurve(b, "b", problems, kFaceCurve) == CurveRead::Ok && b.kind != Kind::Line &&
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
