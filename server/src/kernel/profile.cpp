#include "tinycad/kernel/profile.hpp"

#include <algorithm>
#include <cmath>
#include <optional>
#include <set>
#include <string>

#include "curves2d.hpp"

// Port of the checks of src/kernel/profile.ts: validateFaceInput and parseProfileRegionsInput.
// The TS versions also read `unknown` input (a missing field, a string for a number); in C++ the
// types already guarantee the shape, so only the values are checked. An empty id is "no id".

namespace tinycad::kernel {

namespace {

using core::Curve2;
using core::Vec2;
using detail::endOf;
using detail::Kind;
using detail::samePoint;
using detail::startOf;

/** Spec 06: tolerance of plane.isOrthonormal for the face plane. */
constexpr double kOrthonormalTolerance = 1e-9;
/** Spec 06: the two radii of an arc agree within this, relative. */
constexpr double kRadiusTolerance = 1e-7;
/** Geom_BSplineCurve::MaxDegree(): OCCT refuses a higher degree (M29). */
constexpr int kMaxSplineDegree = 25;
/** Spec 06: an arc radius must be larger than this. */
constexpr double kMinArcRadius = 1e-9;

/** How a curve is read: whether the id is required and a curve of zero length left out. */
struct CurveRules {
  bool idRequired;
  bool skipZeroLength;
};

constexpr CurveRules kFaceCurve{false, false};
constexpr CurveRules kRegionCurve{true, true};

enum class Read { Ok, Skip, Bad };

bool finite(Vec2 v) { return std::isfinite(v[0]) && std::isfinite(v[1]); }

bool finite(const core::Vec3& v) {
  return std::isfinite(v[0]) && std::isfinite(v[1]) && std::isfinite(v[2]);
}

double length(const core::Vec3& v) { return std::hypot(v[0], v[1], v[2]); }

double dot(const core::Vec3& a, const core::Vec3& b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Why a knot vector of the right length is not clamped, or nullopt when it is: the first and
 * the last degree + 1 knots equal, first < last, the interior knots strictly between them,
 * non-decreasing and none repeated more than degree times. The range need not be [0, 1].
 */
std::optional<std::string> knotsProblem(const std::vector<double>& knots, int degree) {
  const auto d = static_cast<std::size_t>(degree);
  const double first = knots.front();
  const double last = knots.back();
  for (std::size_t i = 0; i <= d; ++i) {
    if (knots[i] != first) {
      return "knots must be clamped: the first " + std::to_string(d + 1) + " must be equal";
    }
  }
  for (std::size_t i = knots.size() - d - 1; i < knots.size(); ++i) {
    if (knots[i] != last) {
      return "knots must be clamped: the last " + std::to_string(d + 1) + " must be equal";
    }
  }
  if (!(first < last)) return "the first knot must be smaller than the last one";
  const std::vector<double> interior(knots.begin() + static_cast<std::ptrdiff_t>(d + 1),
                                     knots.end() - static_cast<std::ptrdiff_t>(d + 1));
  for (const double k : interior) {
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
    if (run > degree) {
      return "an interior knot must not repeat more than " + std::to_string(degree) + " times";
    }
  }
  return std::nullopt;
}

Read readLine(const Curve2& c, const std::string& path, std::vector<std::string>& errors,
              CurveRules rules) {
  if (!finite(c.from) || !finite(c.to)) {
    errors.push_back(path + ": from and to must be 2 finite numbers each");
    return Read::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return Read::Skip;
    errors.push_back(path + ": a line must not have zero length");
    return Read::Bad;
  }
  return Read::Ok;
}

Read readArc(const Curve2& c, const std::string& path, std::vector<std::string>& errors,
             CurveRules rules) {
  if (!finite(c.center) || !finite(c.from) || !finite(c.to)) {
    errors.push_back(path + ": center, from and to must be 2 finite numbers each");
    return Read::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return Read::Skip;
    errors.push_back(path + ": an arc must not have zero length");
    return Read::Bad;
  }
  const double r1 = detail::dist(c.from, c.center);
  const double r2 = detail::dist(c.to, c.center);
  if (!(std::abs(r1 - r2) <= kRadiusTolerance * std::max(r1, r2))) {
    errors.push_back(path + ": from and to must be equally far from center");
    return Read::Bad;
  }
  if (!(std::min(r1, r2) > kMinArcRadius)) {
    errors.push_back(path + ": the arc radius must be > 1e-9");
    return Read::Bad;
  }
  return Read::Ok;
}

Read readCircle(const Curve2& c, const std::string& path, std::vector<std::string>& errors) {
  if (!finite(c.center)) {
    errors.push_back(path + ": center must be 2 finite numbers");
    return Read::Bad;
  }
  if (!std::isfinite(c.radius) || !(c.radius > 0)) {
    errors.push_back(path + ": radius must be finite and > 0");
    return Read::Bad;
  }
  return Read::Ok;
}

/** A B-spline checked so that Geom_BSplineCurve never throws on it (M29). */
Read readSpline(const Curve2& c, const std::string& path, std::vector<std::string>& errors,
                CurveRules rules) {
  if (c.degree < 1 || c.degree > kMaxSplineDegree) {
    errors.push_back(path + ": degree must be an integer from 1 to 25");
    return Read::Bad;
  }
  if (!std::all_of(c.poles.begin(), c.poles.end(), [](Vec2 q) { return finite(q); })) {
    errors.push_back(path + ": poles must be an array of 2 finite numbers each");
    return Read::Bad;
  }
  const auto degree = static_cast<std::size_t>(c.degree);
  if (c.poles.size() < degree + 1) {
    errors.push_back(path + ": a spline of degree " + std::to_string(degree) + " needs at least " +
                     std::to_string(degree + 1) + " poles");
    return Read::Bad;
  }
  const bool knotsFinite =
      std::all_of(c.knots.begin(), c.knots.end(), [](double k) { return std::isfinite(k); });
  if (c.knots.size() != c.poles.size() + degree + 1 || !knotsFinite) {
    errors.push_back(path + ": knots must be poles + degree + 1 finite numbers");
    return Read::Bad;
  }
  if (const auto problem = knotsProblem(c.knots, c.degree)) {
    errors.push_back(path + ": " + *problem);
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
Read readCurve(const Curve2& c, const std::string& path, std::vector<std::string>& errors,
               CurveRules rules) {
  if (rules.idRequired && c.id.empty()) {
    errors.push_back(path + ": id must be a non-empty string");
    return Read::Bad;
  }
  switch (c.kind) {
    case Kind::Line:
      return readLine(c, path, errors, rules);
    case Kind::Arc:
      return readArc(c, path, errors, rules);
    case Kind::Circle:
      return readCircle(c, path, errors);
    case Kind::BSpline:
      return readSpline(c, path, errors, rules);
  }
  errors.push_back(path + ": unknown curve kind");
  return Read::Bad;
}

std::string at(const std::string& name, std::size_t i) {
  return name + "[" + std::to_string(i) + "]";
}

/** A loop: a single circle, or line/arc/bspline curves joined end to start, closed. */
void readLoop(const ProfileLoop& loop, const std::string& path, std::vector<std::string>& errors) {
  if (loop.empty()) {
    errors.push_back(path + " must not be empty");
    return;
  }
  bool allOk = true;
  for (std::size_t i = 0; i < loop.size(); ++i) {
    if (readCurve(loop[i], at(path, i), errors, kFaceCurve) != Read::Ok) allOk = false;
  }
  if (!allOk) return;
  const bool hasCircle =
      std::any_of(loop.begin(), loop.end(), [](const Curve2& c) { return c.kind == Kind::Circle; });
  if (hasCircle) {
    if (loop.size() != 1) errors.push_back(path + ": a circle must be the only curve of its loop");
    return;
  }
  for (std::size_t i = 0; i < loop.size(); ++i) {
    if (!samePoint(endOf(loop[i]), startOf(loop[(i + 1) % loop.size()]))) {
      errors.push_back(at(path, i) +
                       ": its end must lie on the start of the next curve (closed loop)");
      return;
    }
  }
}

}  // namespace

std::vector<std::string> validateFaceInput(const FaceInput& input) {
  std::vector<std::string> errors;
  const core::Plane& plane = input.plane;
  if (!finite(plane.origin) || !finite(plane.xDir) || !finite(plane.normal)) {
    errors.emplace_back("plane: origin, xDir and normal must be 3 finite numbers each");
  } else if (!(std::abs(length(plane.xDir) - 1) <= kOrthonormalTolerance &&
               std::abs(length(plane.normal) - 1) <= kOrthonormalTolerance &&
               std::abs(dot(plane.xDir, plane.normal)) <= kOrthonormalTolerance)) {
    errors.emplace_back("plane: xDir and normal must be unit and perpendicular");
  }
  readLoop(input.outer, "outer", errors);
  for (std::size_t i = 0; i < input.holes.size(); ++i)
    readLoop(input.holes[i], at("holes", i), errors);
  return errors;
}

core::Result<std::vector<ProfileCurve>, std::vector<std::string>> parseProfileRegionsInput(
    const std::vector<ProfileCurve>& curves) {
  std::vector<std::string> errors;
  std::vector<ProfileCurve> checked;
  std::set<std::string> seen;
  for (std::size_t i = 0; i < curves.size(); ++i) {
    const std::string path = at("curves", i);
    const Curve2& curve = curves[i];
    // Unique among all curves, the skipped ones of zero length too.
    if (!curve.id.empty()) {
      if (seen.contains(curve.id))
        errors.push_back(path + ": id " + curve.id + " is used by another curve");
      seen.insert(curve.id);
    }
    if (readCurve(curve, path, errors, kRegionCurve) == Read::Ok) checked.push_back(curve);
  }
  if (!errors.empty()) return core::fail(std::move(errors));
  return checked;
}

}  // namespace tinycad::kernel
