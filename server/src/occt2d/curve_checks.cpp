#include "tinycad/occt2d/curve_checks.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>

// Port of the curve checks of src/kernel/profile.ts. The TS versions also read `unknown` input
// (a missing field, a string for a number); in C++ the types already guarantee the shape, so
// only the values are checked. An empty id is "no id".

namespace tinycad::occt2d {

namespace {

/** Spec 06: the two radii of an arc agree within this, relative. */
constexpr double kRadiusTolerance = 1e-7;
/** Geom_BSplineCurve::MaxDegree(): OCCT refuses a higher degree (M29). */
constexpr int kMaxSplineDegree = 25;
/** Spec 06: an arc radius must be larger than this. */
constexpr double kMinArcRadius = 1e-9;

bool finite(Vec2 v) { return std::isfinite(v[0]) && std::isfinite(v[1]); }

CurveRead readLine(const Curve2& c, const std::string& path, std::vector<std::string>& problems,
                   CurveRules rules) {
  if (!finite(c.from) || !finite(c.to)) {
    problems.push_back(path + ": from and to must be 2 finite numbers each");
    return CurveRead::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return CurveRead::Skip;
    problems.push_back(path + ": a line must not have zero length");
    return CurveRead::Bad;
  }
  return CurveRead::Ok;
}

CurveRead readArc(const Curve2& c, const std::string& path, std::vector<std::string>& problems,
                  CurveRules rules) {
  if (!finite(c.center) || !finite(c.from) || !finite(c.to)) {
    problems.push_back(path + ": center, from and to must be 2 finite numbers each");
    return CurveRead::Bad;
  }
  if (samePoint(c.from, c.to)) {
    if (rules.skipZeroLength) return CurveRead::Skip;
    problems.push_back(path + ": an arc must not have zero length");
    return CurveRead::Bad;
  }
  const double r1 = dist(c.from, c.center);
  const double r2 = dist(c.to, c.center);
  if (!(std::abs(r1 - r2) <= kRadiusTolerance * std::max(r1, r2))) {
    problems.push_back(path + ": from and to must be equally far from center");
    return CurveRead::Bad;
  }
  if (!(std::min(r1, r2) > kMinArcRadius)) {
    problems.push_back(path + ": the arc radius must be > 1e-9");
    return CurveRead::Bad;
  }
  return CurveRead::Ok;
}

CurveRead readCircle(const Curve2& c, const std::string& path, std::vector<std::string>& problems) {
  if (!finite(c.center)) {
    problems.push_back(path + ": center must be 2 finite numbers");
    return CurveRead::Bad;
  }
  if (!std::isfinite(c.radius) || !(c.radius > 0)) {
    problems.push_back(path + ": radius must be finite and > 0");
    return CurveRead::Bad;
  }
  return CurveRead::Ok;
}

/** A B-spline checked so that Geom2d_BSplineCurve never throws on it (M29). */
CurveRead readSpline(const Curve2& c, const std::string& path, std::vector<std::string>& problems,
                     CurveRules rules) {
  if (c.degree < 1 || c.degree > kMaxSplineDegree) {
    problems.push_back(path + ": degree must be an integer from 1 to 25");
    return CurveRead::Bad;
  }
  if (!std::all_of(c.poles.begin(), c.poles.end(), [](Vec2 q) { return finite(q); })) {
    problems.push_back(path + ": poles must be an array of 2 finite numbers each");
    return CurveRead::Bad;
  }
  const auto degree = static_cast<std::size_t>(c.degree);
  if (c.poles.size() < degree + 1) {
    problems.push_back(path + ": a spline of degree " + std::to_string(degree) +
                       " needs at least " + std::to_string(degree + 1) + " poles");
    return CurveRead::Bad;
  }
  const bool knotsFinite =
      std::all_of(c.knots.begin(), c.knots.end(), [](double k) { return std::isfinite(k); });
  if (c.knots.size() != c.poles.size() + degree + 1 || !knotsFinite) {
    problems.push_back(path + ": knots must be poles + degree + 1 finite numbers");
    return CurveRead::Bad;
  }
  if (const auto problem = knotsProblem(c.knots, c.degree)) {
    problems.push_back(path + ": " + *problem);
    return CurveRead::Bad;
  }
  // Zero length: every pole in one point (the curve lies in the hull of its poles). Its ends
  // alone do not tell: a closed spline has both in one point.
  const bool onePoint = std::all_of(c.poles.begin(), c.poles.end(),
                                    [&](Vec2 q) { return samePoint(q, c.poles.front()); });
  if (rules.skipZeroLength && onePoint) return CurveRead::Skip;
  return CurveRead::Ok;
}

}  // namespace

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

CurveRead readCurve(const Curve2& curve, const std::string& path,
                    std::vector<std::string>& problems, CurveRules rules) {
  if (rules.idRequired && curve.id.empty()) {
    problems.push_back(path + ": id must be a non-empty string");
    return CurveRead::Bad;
  }
  switch (curve.kind) {
    case Kind::Line:
      return readLine(curve, path, problems, rules);
    case Kind::Arc:
      return readArc(curve, path, problems, rules);
    case Kind::Circle:
      return readCircle(curve, path, problems);
    case Kind::BSpline:
      return readSpline(curve, path, problems, rules);
  }
  problems.push_back(path + ": unknown curve kind");
  return CurveRead::Bad;
}

}  // namespace tinycad::occt2d
