// Port of toPrimitives and its helpers in src/solver-planegcs/solve.ts: entities and constraints
// of a sketch as planegcs primitives, in the same order, with the same ids and numbers.

#include "primitives.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <set>
#include <stdexcept>

#include "bspline.hpp"

namespace tinycad::solver_planegcs {

namespace {

using namespace sketch;
using EntityMap = std::unordered_map<SketchEntityId, const SketchEntity*>;

struct XY {
  double x = 0, y = 0;
};

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }

/** A line as planegcs sees it: an xline is a line through p1 and p2 (M31, asLine). */
bool isLine(const SketchEntity& e) {
  return e.kind() == EntityKind::Line || e.kind() == EntityKind::XLine;
}

SketchEntityId lineP1(const SketchEntity& e) {
  return e.kind() == EntityKind::Line ? e.as<SketchLine>().p1 : e.as<SketchXLine>().p1;
}

SketchEntityId lineP2(const SketchEntity& e) {
  return e.kind() == EntityKind::Line ? e.as<SketchLine>().p2 : e.as<SketchXLine>().p2;
}

/** The kind name of an entity as planegcs sees it (an xline is a line). */
std::string solverKind(const SketchEntity& e) {
  return isLine(e) ? "line" : std::string(entityKindName(e.kind()));
}

const SketchPoint& pointOf(const EntityMap& entities, const SketchEntityId& id) {
  const auto it = entities.find(id);
  if (it == entities.end() || it->second->kind() != EntityKind::Point) {
    fail(id.str() + " is not a point");
  }
  return it->second->as<SketchPoint>();
}

const SketchEntity& curveOf(const EntityMap& entities, const SketchEntityId& id) {
  const auto it = entities.find(id);
  if (it == entities.end() || !it->second->isCurve()) fail(id.str() + " is not a curve");
  return *it->second;
}

XY direction(const EntityMap& entities, const SketchEntityId& from, const SketchEntityId& to) {
  const SketchPoint& p = pointOf(entities, from);
  const SketchPoint& q = pointOf(entities, to);
  return {q.x - p.x, q.y - p.y};
}

Primitive constraint(PrimitiveType type, std::string id, std::vector<std::string> refs,
                     std::vector<ParamValue> values = {}) {
  Primitive p;
  p.type = type;
  p.id = std::move(id);
  p.refs = std::move(refs);
  p.values = std::move(values);
  return p;
}

Primitive point(std::string id, double x, double y) {
  Primitive p;
  p.type = PrimitiveType::Point;
  p.id = std::move(id);
  p.x = x;
  p.y = y;
  // Never fixed: a constraint between two fixed points would be ignored silently (ADR 0016).
  p.fixed = false;
  return p;
}

/** A planegcs bspline (no weights, clamped): planegcs wants distinct knots with multiplicities. */
Primitive bsplinePrimitive(std::string id, std::vector<std::string> poleIds,
                           const std::vector<double>& knots, int degree) {
  Primitive p;
  p.type = PrimitiveType::BSpline;
  p.id = std::move(id);
  p.weights.assign(poleIds.size(), 1.0);
  p.refs = std::move(poleIds);
  for (double k : knots) {
    if (std::find(p.knots.begin(), p.knots.end(), k) == p.knots.end()) p.knots.push_back(k);
  }
  for (double k : p.knots) {
    p.mult.push_back(static_cast<int>(std::count(knots.begin(), knots.end(), k)));
  }
  p.degree = degree;
  return p;
}

std::vector<std::string> ids(const std::vector<SketchEntityId>& entityIds) {
  std::vector<std::string> out;
  for (const auto& id : entityIds) out.push_back(id.str());
  return out;
}

std::vector<Primitive> entityPrimitives(const SketchEntity& e, const EntityMap& entities) {
  switch (e.kind()) {
    case EntityKind::Point: {
      const auto& p = e.as<SketchPoint>();
      return {point(p.id().str(), p.x, p.y)};
    }
    case EntityKind::Line:
    case EntityKind::XLine: {
      Primitive line;
      line.type = PrimitiveType::Line;
      line.id = e.id().str();
      line.refs = {lineP1(e).str(), lineP2(e).str()};
      return {line};
    }
    case EntityKind::Circle: {
      const auto& c = e.as<SketchCircle>();
      Primitive circle;
      circle.type = PrimitiveType::Circle;
      circle.id = c.id().str();
      circle.refs = {c.center.str()};
      circle.radius = c.radius;
      return {circle};
    }
    case EntityKind::Arc: {
      const auto& a = e.as<SketchArc>();
      const SketchPoint& center = pointOf(entities, a.center);
      const SketchPoint& start = pointOf(entities, a.start);
      const SketchPoint& end = pointOf(entities, a.end);
      const double startAngle = std::atan2(start.y - center.y, start.x - center.x);
      double endAngle = std::atan2(end.y - center.y, end.x - center.x);
      // Counter-clockwise from start to end.
      if (endAngle <= startAngle) endAngle += 2 * std::numbers::pi;
      Primitive arc;
      arc.type = PrimitiveType::Arc;
      arc.id = a.id().str();
      arc.refs = {a.center.str(), a.start.str(), a.end.str()};
      arc.startAngle = startAngle;
      arc.endAngle = endAngle;
      arc.radius = std::hypot(start.x - center.x, start.y - center.y);
      // Ties the end points to the angles and the radius; not a sketch constraint.
      return {arc, constraint(PrimitiveType::ArcRules, a.id().str() + ":rules", {a.id().str()})};
    }
    case EntityKind::BSpline:
      // Only its control points (Q087), which are sketch points; the curve itself goes into
      // planegcs only when a point lies on it (toPrimitives).
      return {};
    case EntityKind::FitSpline: {
      // The control points are hidden planegcs points, started from the poles in the data.
      const auto& f = e.as<SketchFitSpline>();
      std::vector<Primitive> out;
      std::vector<std::string> poleIds;
      for (std::size_t i = 0; i < f.poles.size(); ++i) {
        poleIds.push_back(poleId(f.id(), i));
        out.push_back(point(poleIds.back(), f.poles[i][0], f.poles[i][1]));
      }
      out.push_back(bsplinePrimitive(f.id().str(), poleIds, f.knots, f.degree));
      return out;
    }
    case EntityKind::Mirror:
    case EntityKind::LinearPattern:
    case EntityKind::CircularPattern:
    case EntityKind::Text:
      // Recipes (M36, M37): their copies and letters are derived from the solved originals,
      // never solved.
      break;
  }
  return {};
}

/** Every fit point on the curve at its fixed parameter (a number: no degree of freedom). */
std::vector<Primitive> fitPrimitives(const SketchFitSpline& spline) {
  std::vector<Primitive> out;
  for (std::size_t i = 0; i < spline.params.size(); ++i) {
    if (i >= spline.fit.size()) fail(spline.id().str() + " has no fit point " + std::to_string(i));
    out.push_back(constraint(PrimitiveType::PointOnBSpline,
                             spline.id().str() + ":fit" + std::to_string(i),
                             {spline.fit[i].str(), spline.id().str()},
                             {ParamValue::of(spline.params[i])}));
  }
  return out;
}

/** The curve of a spline as it enters the solve: sketch points or the poles in the data. */
core::BSplineShape shapeOf(const SketchEntity& spline, const EntityMap& entities) {
  if (spline.kind() == EntityKind::FitSpline) {
    const auto& f = spline.as<SketchFitSpline>();
    return {f.degree, f.poles, f.knots};
  }
  const auto& b = spline.as<SketchBSpline>();
  std::vector<core::Vec2> poles;
  for (const auto& id : b.poles) {
    const SketchPoint& p = pointOf(entities, id);
    poles.push_back({p.x, p.y});
  }
  return {b.degree, std::move(poles), b.knots};
}

/** Samples per knot span when looking for the nearest curve point. */
constexpr int SAMPLES_PER_SPAN = 16;
/** Newton steps refining the nearest sample. */
constexpr int NEWTON_STEPS = 8;

/**
 * The parameter in [0, 1] of the curve point nearest to p: the nearest of samples in every knot
 * span, refined by Newton on (C(t) − p) · C'(t) = 0. Only a start value for planegcs.
 */
double nearestParam(const core::BSplineShape& curve, const core::Vec2& p) {
  const auto distance2 = [&](double t) {
    const core::Vec2 c = bspline::evaluate(curve, t);
    return std::pow(c[0] - p[0], 2) + std::pow(c[1] - p[1], 2);
  };
  std::vector<double> knots;
  for (double k : curve.knots) {
    if (std::find(knots.begin(), knots.end(), k) == knots.end()) knots.push_back(k);
  }
  double best = 0;
  double bestDistance = distance2(0);
  for (std::size_t i = 1; i < knots.size(); ++i) {
    const double a = knots[i - 1];
    const double b = knots[i];
    for (int k = 1; k <= SAMPLES_PER_SPAN; ++k) {
      const double t = a + ((b - a) * k) / SAMPLES_PER_SPAN;
      const double d = distance2(t);
      if (d < bestDistance) {
        best = t;
        bestDistance = d;
      }
    }
  }
  for (int i = 0; i < NEWTON_STEPS; ++i) {
    const core::Vec2 c = bspline::evaluate(curve, best);
    const core::Vec2 d1 = bspline::derivative(curve, best, 1);
    const core::Vec2 d2 = bspline::derivative(curve, best, 2);
    const double rx = c[0] - p[0];
    const double ry = c[1] - p[1];
    const double slope = d1[0] * d1[0] + d1[1] * d1[1] + rx * d2[0] + ry * d2[1];
    if (!(slope > 0)) break;
    best = std::min(1.0, std::max(0.0, best - (rx * d1[0] + ry * d1[1]) / slope));
  }
  return best;
}

/**
 * pointOnCurve on a spline: point_on_bspline with a free parameter `<id>:t`, started from the
 * parameter of the curve point nearest to the point (spec 12, Bod na splinu). With an end, the
 * parameter is that number instead – fixed, no degree of freedom.
 */
Primitive pointOnSpline(const PointOnCurveConstraint& c, const SketchEntity& spline,
                        const EntityMap& entities, std::optional<int> end,
                        std::optional<FreeParam>& param) {
  const std::vector<std::string> refs = {c.point.str(), spline.id().str()};
  if (end) {
    return constraint(PrimitiveType::PointOnBSpline, c.id().str(), refs, {ParamValue::of(*end)});
  }
  std::string name = c.id().str() + ":t";
  const SketchPoint& p = pointOf(entities, c.point);
  const double value = nearestParam(shapeOf(spline, entities), {p.x, p.y});
  param = FreeParam{name, value, c.id()};
  return constraint(PrimitiveType::PointOnBSpline, c.id().str(), refs,
                    {ParamValue::param(name)});
}

/**
 * The control point next to the end the line shares (Q087): a clamped spline starts in P0 with
 * its tangent along P1 − P0, so the line through P0 is tangent when P1 lies on it (at the last end
 * the second-to-last control point).
 */
std::string nextToEnd(const SketchEntity& line, const SketchEntity& spline) {
  const bool isBSpline = spline.kind() == EntityKind::BSpline;
  const std::vector<SketchEntityId>& ends =
      isBSpline ? spline.as<SketchBSpline>().poles : spline.as<SketchFitSpline>().fit;
  const std::size_t n = ends.size();
  const SketchEntityId p1 = lineP1(line);
  const SketchEntityId p2 = lineP2(line);
  const auto shares = [&](const SketchEntityId& p) { return p == p1 || p == p2; };
  std::optional<std::size_t> i;
  if (n > 0 && shares(ends[0])) {
    i = 1;
  } else if (n > 0 && shares(ends[n - 1])) {
    i = n - 2;
  }
  if (!i) fail(line.id().str() + " does not share an end of " + spline.id().str());
  if (!isBSpline) return poleId(spline.id(), *i);
  const auto& poles = spline.as<SketchBSpline>().poles;
  if (*i >= poles.size()) fail(spline.id().str() + " has no control point");
  return poles[*i].str();
}

/** The end points of a line or an arc, else none. */
std::vector<SketchEntityId> endsOf(const SketchEntity& c) {
  if (isLine(c)) return {lineP1(c), lineP2(c)};
  if (c.kind() == EntityKind::Arc) return {c.as<SketchArc>().start, c.as<SketchArc>().end};
  return {};
}

/**
 * The end point a line or an arc shares with another line or arc (spec 12, "Tečnost ve sdíleném
 * koncovém bodě"); nullopt for any other pair.
 */
std::optional<SketchEntityId> sharedEnd(const SketchEntity& a, const SketchEntity& b) {
  const auto endsA = endsOf(a);
  const auto endsB = endsOf(b);
  if (endsA.empty() || endsB.empty()) return std::nullopt;
  if (isLine(a) && isLine(b)) return std::nullopt;
  for (const auto& p : endsA) {
    if (std::find(endsB.begin(), endsB.end(), p) != endsB.end()) return p;
  }
  return std::nullopt;
}

/**
 * The tangent direction of a line (p1 → p2) or an arc (counter-clockwise) in its end point, in
 * the sense planegcs measures the angle via a point.
 */
XY tangentAt(const SketchEntity& c, const SketchEntityId& at, const EntityMap& entities) {
  if (isLine(c)) return direction(entities, lineP1(c), lineP2(c));
  if (c.kind() != EntityKind::Arc) fail("tangent in an end point of a " + solverKind(c));
  const XY r = direction(entities, c.as<SketchArc>().center, at);
  return {-r.y, r.x};
}

/**
 * Tangency in a shared end point as FreeCAD does it: the angle between the curves in the point is
 * 0 or π, whichever is nearer to the current one.
 */
Primitive tangentAtEndPrimitive(std::string id, const SketchEntity& a, const SketchEntity& b,
                                const SketchEntityId& at, const EntityMap& entities) {
  const XY ta = tangentAt(a, at, entities);
  const XY tb = tangentAt(b, at, entities);
  const bool sameSense = ta.x * tb.x + ta.y * tb.y >= 0;
  return constraint(PrimitiveType::AngleViaPoint, std::move(id),
                    {a.id().str(), b.id().str(), at.str()},
                    {ParamValue::of(sameSense ? 0 : std::numbers::pi)});
}

Primitive tangentPrimitive(std::string id, const SketchEntity& a, const SketchEntity& b,
                           const EntityMap& entities) {
  if (const auto shared = sharedEnd(a, b)) {
    return tangentAtEndPrimitive(std::move(id), a, b, *shared, entities);
  }
  // The line always first.
  const SketchEntity& first = isLine(b) ? b : a;
  const SketchEntity& second = isLine(b) ? a : b;
  const std::string k1 = solverKind(first);
  const std::string k2 = solverKind(second);
  const std::string i1 = first.id().str();
  const std::string i2 = second.id().str();
  if (k1 == "line" && (k2 == "bspline" || k2 == "fitSpline")) {
    return constraint(PrimitiveType::PointOnLinePL, std::move(id), {nextToEnd(first, second), i1});
  }
  if (k1 == "line" && k2 == "circle") return constraint(PrimitiveType::TangentLC, std::move(id), {i1, i2});
  if (k1 == "line" && k2 == "arc") return constraint(PrimitiveType::TangentLA, std::move(id), {i1, i2});
  if (k1 == "circle" && k2 == "circle") return constraint(PrimitiveType::TangentCC, std::move(id), {i1, i2});
  if (k1 == "arc" && k2 == "arc") return constraint(PrimitiveType::TangentAA, std::move(id), {i1, i2});
  if (k1 == "circle" && k2 == "arc") return constraint(PrimitiveType::TangentCA, std::move(id), {i1, i2});
  if (k1 == "arc" && k2 == "circle") return constraint(PrimitiveType::TangentCA, std::move(id), {i2, i1});
  fail("tangent between a " + solverKind(a) + " and a " + solverKind(b));
}

Primitive equalPrimitive(std::string id, const SketchEntity& a, const SketchEntity& b) {
  const std::string ka = solverKind(a);
  const std::string kb = solverKind(b);
  const std::string ia = a.id().str();
  const std::string ib = b.id().str();
  if (ka == "line" && kb == "line") return constraint(PrimitiveType::EqualLength, std::move(id), {ia, ib});
  if (ka == "circle" && kb == "circle") return constraint(PrimitiveType::EqualRadiusCC, std::move(id), {ia, ib});
  if (ka == "arc" && kb == "arc") return constraint(PrimitiveType::EqualRadiusAA, std::move(id), {ia, ib});
  if (ka == "circle" && kb == "arc") return constraint(PrimitiveType::EqualRadiusCA, std::move(id), {ia, ib});
  if (ka == "arc" && kb == "circle") return constraint(PrimitiveType::EqualRadiusCA, std::move(id), {ib, ia});
  fail("equal between a " + ka + " and a " + kb);
}

/** On the whole carrier line of a line, on the whole circle of a circle or an arc (spec 12). */
Primitive pointOnCurvePrimitive(std::string id, const SketchEntityId& point,
                                const SketchEntity& curve) {
  const std::string k = solverKind(curve);
  const std::vector<std::string> refs = {point.str(), curve.id().str()};
  if (k == "line") return constraint(PrimitiveType::PointOnLinePL, std::move(id), refs);
  if (k == "circle") return constraint(PrimitiveType::PointOnCircle, std::move(id), refs);
  if (k == "arc") return constraint(PrimitiveType::PointOnArc, std::move(id), refs);
  fail("point on a " + k);
}

/**
 * hDistance/vDistance: the model value is unsigned, planegcs `difference` is signed
 * (param2 − param1 = difference). The order follows the current position, so the solve keeps the
 * points on their sides: b right of / above a (or level with it) → b − a, else a − b.
 */
Primitive axisDistancePrimitive(std::string id, const char* axis, const DistanceConstraint& c,
                                const EntityMap& entities) {
  const SketchPoint& a = pointOf(entities, c.a);
  const SketchPoint& b = pointOf(entities, c.b);
  const bool x = std::string(axis) == "x";
  const bool forward = x ? b.x >= a.x : b.y >= a.y;
  const SketchEntityId& from = forward ? c.a : c.b;
  const SketchEntityId& to = forward ? c.b : c.a;
  return constraint(PrimitiveType::Difference, std::move(id), {},
                    {ParamValue::propertyOf(from.str(), axis),
                     ParamValue::propertyOf(to.str(), axis), ParamValue::of(c.value)});
}

/** The end points of a line, swapped when its direction is reversed. */
std::pair<SketchEntityId, SketchEntityId> orientedEnds(const EntityMap& entities,
                                                       const SketchEntityId& id, bool reverse) {
  const SketchEntity& line = curveOf(entities, id);
  if (!isLine(line)) fail(id.str() + " is not a line");
  return reverse ? std::pair{lineP2(line), lineP1(line)} : std::pair{lineP1(line), lineP2(line)};
}

/**
 * angle: the model value is unsigned in (0, π) between the directions p1→p2 (reversed by the
 * flags); planegcs l2l_angle_pppp is the oriented angle from the first line to the second. The
 * lines go in the order in which the current angle is counter-clockwise (positive).
 */
Primitive anglePrimitive(const AngleConstraint& c, const EntityMap& entities) {
  const auto [a1, a2] = orientedEnds(entities, c.a, c.reverseA);
  const auto [b1, b2] = orientedEnds(entities, c.b, c.reverseB);
  const XY da = direction(entities, a1, a2);
  const XY db = direction(entities, b1, b2);
  const bool counterClockwise = da.x * db.y - da.y * db.x >= 0;
  std::vector<std::string> refs = counterClockwise
                                      ? std::vector{a1.str(), a2.str(), b1.str(), b2.str()}
                                      : std::vector{b1.str(), b2.str(), a1.str(), a2.str()};
  return constraint(PrimitiveType::L2LAnglePPPP, c.id().str(), std::move(refs),
                    {ParamValue::of(c.value)});
}

/** Relative tolerance of "the copy line is tangent to the copy arc in their shared point". */
constexpr double TANGENT_TOLERANCE = 1e-6;

/**
 * The copy arc of the same offset that ends in `end` of the copy line and to which the line is
 * tangent there now (its direction perpendicular to the radius); nullptr if none.
 */
const SketchArc* tangentCopyArc(const OffsetConstraint& c, const SketchEntity& line,
                                const SketchEntityId& end, const EntityMap& entities) {
  const XY along = direction(entities, lineP1(line), lineP2(line));
  for (const auto& pair : c.pairs) {
    const SketchEntity& copy = curveOf(entities, pair.copy);
    if (copy.kind() != EntityKind::Arc) continue;
    const auto& arc = copy.as<SketchArc>();
    if (arc.start != end && arc.end != end) continue;
    const XY radius = direction(entities, arc.center, end);
    const double dot = along.x * radius.x + along.y * radius.y;
    const double scale = std::hypot(along.x, along.y) * std::hypot(radius.x, radius.y);
    if (std::abs(dot) <= TANGENT_TOLERANCE * scale) return &arc;
  }
  return nullptr;
}

/** The current radius of a circle or an arc (an arc: from its start point). */
double radiusOf(const SketchEntity& c, const EntityMap& entities) {
  if (c.kind() == EntityKind::Circle) return c.as<SketchCircle>().radius;
  if (c.kind() != EntityKind::Arc) fail("offset of a " + solverKind(c));
  const XY d = direction(entities, c.as<SketchArc>().center, c.as<SketchArc>().start);
  return std::hypot(d.x, d.y);
}

/**
 * One pair of an offset (M35, spec 12 "Vazba offset"), ids `<pair id>:a|b`: lines keep every end
 * of the copy at the distance from the source carrier line, or tangent to a copy arc there; arcs
 * and circles a signed difference of the radii in the current order.
 */
std::vector<Primitive> offsetPrimitives(const std::string& id, const OffsetPair& pair,
                                        const OffsetConstraint& c, const EntityMap& entities) {
  const SketchEntity& source = curveOf(entities, pair.source);
  const SketchEntity& copy = curveOf(entities, pair.copy);
  if (isLine(source) && isLine(copy)) {
    std::vector<Primitive> out;
    const std::pair<std::string, SketchEntityId> ends[] = {{id + ":a", lineP1(copy)},
                                                           {id + ":b", lineP2(copy)}};
    for (const auto& [pid, end] : ends) {
      const SketchArc* arc = tangentCopyArc(c, copy, end, entities);
      if (arc == nullptr) {
        out.push_back(constraint(PrimitiveType::P2LDistance, pid, {end.str(), source.id().str()},
                                 {ParamValue::of(c.value)}));
      } else {
        out.push_back(tangentAtEndPrimitive(pid, copy, *arc, end, entities));
      }
    }
    return out;
  }
  const double rs = radiusOf(source, entities);
  const double rc = radiusOf(copy, entities);
  const std::string from = rc >= rs ? source.id().str() : copy.id().str();
  const std::string to = rc >= rs ? copy.id().str() : source.id().str();
  return {constraint(PrimitiveType::Difference, id + ":a", {},
                     {ParamValue::propertyOf(from, "radius"), ParamValue::propertyOf(to, "radius"),
                      ParamValue::of(c.value)})};
}

std::vector<Primitive> constraintPrimitives(const SketchConstraint& c, const EntityMap& entities) {
  const std::string id = c.id().str();
  switch (c.kind()) {
    case ConstraintKind::Coincident: {
      const auto& p = c.as<PairConstraint>();
      return {constraint(PrimitiveType::P2PCoincident, id, {p.a.str(), p.b.str()})};
    }
    case ConstraintKind::Horizontal:
      return {constraint(PrimitiveType::HorizontalL, id, {c.as<LineConstraint>().line.str()})};
    case ConstraintKind::Vertical:
      return {constraint(PrimitiveType::VerticalL, id, {c.as<LineConstraint>().line.str()})};
    case ConstraintKind::Parallel: {
      const auto& p = c.as<PairConstraint>();
      return {constraint(PrimitiveType::Parallel, id, {p.a.str(), p.b.str()})};
    }
    case ConstraintKind::Perpendicular: {
      const auto& p = c.as<PairConstraint>();
      return {constraint(PrimitiveType::PerpendicularLL, id, {p.a.str(), p.b.str()})};
    }
    case ConstraintKind::Equal: {
      const auto& p = c.as<PairConstraint>();
      return {equalPrimitive(id, curveOf(entities, p.a), curveOf(entities, p.b))};
    }
    case ConstraintKind::Tangent: {
      const auto& p = c.as<PairConstraint>();
      return {tangentPrimitive(id, curveOf(entities, p.a), curveOf(entities, p.b), entities)};
    }
    case ConstraintKind::PointOnCurve: {
      const auto& p = c.as<PointOnCurveConstraint>();
      return {pointOnCurvePrimitive(id, p.point, curveOf(entities, p.curve))};
    }
    case ConstraintKind::Midpoint: {
      // p1 and p2 symmetric about the point: the point is the middle of the line.
      const auto& m = c.as<MidpointConstraint>();
      const SketchEntity& line = curveOf(entities, m.line);
      if (!isLine(line)) fail("midpoint of a " + solverKind(line));
      return {constraint(PrimitiveType::P2PSymmetricPPP, id,
                         {lineP1(line).str(), lineP2(line).str(), m.point.str()})};
    }
    case ConstraintKind::HAlign: {
      const auto& p = c.as<PairConstraint>();
      return {constraint(PrimitiveType::HorizontalPP, id, {p.a.str(), p.b.str()})};
    }
    case ConstraintKind::VAlign: {
      const auto& p = c.as<PairConstraint>();
      return {constraint(PrimitiveType::VerticalPP, id, {p.a.str(), p.b.str()})};
    }
    case ConstraintKind::Symmetric: {
      const auto& s = c.as<SymmetricConstraint>();
      return {constraint(PrimitiveType::P2PSymmetricPPL, id, {s.a.str(), s.b.str(), s.axis.str()})};
    }
    case ConstraintKind::Fix: {
      // Two equations on the current coordinates instead of `fixed: true` (ADR 0016).
      const auto& f = c.as<FixConstraint>();
      const SketchPoint& p = pointOf(entities, f.point);
      return {constraint(PrimitiveType::CoordinateX, id + ":x", {f.point.str()},
                         {ParamValue::of(p.x)}),
              constraint(PrimitiveType::CoordinateY, id + ":y", {f.point.str()},
                         {ParamValue::of(p.y)})};
    }
    case ConstraintKind::Distance: {
      const auto& d = c.as<DistanceConstraint>();
      return {constraint(PrimitiveType::P2PDistance, id, {d.a.str(), d.b.str()},
                         {ParamValue::of(d.value)})};
    }
    case ConstraintKind::Radius:
    case ConstraintKind::Diameter: {
      const auto& r = c.as<RadialConstraint>();
      const SketchEntity& curve = curveOf(entities, r.curve);
      const bool radius = c.kind() == ConstraintKind::Radius;
      const std::vector<ParamValue> values = {ParamValue::of(r.value)};
      if (curve.kind() == EntityKind::Circle) {
        return {constraint(radius ? PrimitiveType::CircleRadius : PrimitiveType::CircleDiameter,
                           id, {curve.id().str()}, values)};
      }
      if (curve.kind() == EntityKind::Arc) {
        return {constraint(radius ? PrimitiveType::ArcRadius : PrimitiveType::ArcDiameter, id,
                           {curve.id().str()}, values)};
      }
      fail(std::string(radius ? "radius" : "diameter") + " of a " + solverKind(curve));
    }
    case ConstraintKind::HDistance:
      return {axisDistancePrimitive(id, "x", c.as<DistanceConstraint>(), entities)};
    case ConstraintKind::VDistance:
      return {axisDistancePrimitive(id, "y", c.as<DistanceConstraint>(), entities)};
    case ConstraintKind::PointLineDistance: {
      const auto& d = c.as<PointLineDistanceConstraint>();
      return {constraint(PrimitiveType::P2LDistance, id, {d.point.str(), d.line.str()},
                         {ParamValue::of(d.value)})};
    }
    case ConstraintKind::Angle:
      return {anglePrimitive(c.as<AngleConstraint>(), entities)};
    case ConstraintKind::Offset: {
      const auto& o = c.as<OffsetConstraint>();
      std::vector<Primitive> out;
      for (std::size_t i = 0; i < o.pairs.size(); ++i) {
        for (auto& p : offsetPrimitives(id + ":" + std::to_string(i), o.pairs[i], o, entities)) {
          out.push_back(std::move(p));
        }
      }
      return out;
    }
  }
  return {};
}

}  // namespace

std::string poleId(const SketchEntityId& spline, std::size_t i) {
  return spline.str() + ":pole" + std::to_string(i);
}

int unusedSplineParams(const std::vector<Primitive>& primitives) {
  // For every bspline a constraint refers to, the wrapper creates 4 free parameters for the start
  // and end of the curve – copies of the end control points – and no equation uses them.
  std::set<std::string> referenced;
  for (const auto& p : primitives) {
    if (p.type == PrimitiveType::PointOnBSpline) referenced.insert(p.refs.at(1));
  }
  return 4 * static_cast<int>(referenced.size());
}

Primitives toPrimitives(const Sketch& sketch, const std::optional<Drag>& drag, const Ends& ends) {
  EntityMap kinds;
  for (const auto& e : sketch.entities()) kinds[e->id()] = e.get();
  Primitives out;
  std::vector<Primitive> primitives;
  for (const auto& e : sketch.entities()) {
    for (auto& p : entityPrimitives(*e, kinds)) primitives.push_back(std::move(p));
  }

  // A bspline only when a point lies on it (Q087): nothing else in planegcs refers to the curve.
  std::set<SketchEntityId> onBSpline;
  for (const auto& c : sketch.constraints()) {
    if (c->kind() != ConstraintKind::PointOnCurve) continue;
    const auto it = kinds.find(c->as<PointOnCurveConstraint>().curve);
    if (it != kinds.end() && it->second->kind() == EntityKind::BSpline) {
      onBSpline.insert(it->first);
    }
  }

  // After all entities: the control and fit points may come after their spline. The fit point
  // constraints are internal, not reported back (spec 12, Spliny).
  for (const auto& e : sketch.entities()) {
    if (e->kind() == EntityKind::FitSpline) {
      for (auto& p : fitPrimitives(e->as<SketchFitSpline>())) primitives.push_back(std::move(p));
    }
    if (e->kind() == EntityKind::BSpline && onBSpline.contains(e->id())) {
      const auto& b = e->as<SketchBSpline>();
      primitives.push_back(bsplinePrimitive(b.id().str(), ids(b.poles), b.knots, b.degree));
    }
  }

  for (const auto& c : sketch.constraints()) {
    if (c->kind() == ConstraintKind::PointOnCurve) {
      const auto& onCurve = c->as<PointOnCurveConstraint>();
      const auto it = kinds.find(onCurve.curve);
      const bool spline = it != kinds.end() && (it->second->kind() == EntityKind::BSpline ||
                                                it->second->kind() == EntityKind::FitSpline);
      if (spline) {
        const auto end = ends.find(c->id());
        std::optional<FreeParam> param;
        Primitive primitive = pointOnSpline(
            onCurve, *it->second, kinds,
            end == ends.end() ? std::nullopt : std::optional<int>(end->second), param);
        if (param) out.params.push_back(*param);
        out.constraintIds.emplace(primitive.id, c->id());
        primitives.push_back(std::move(primitive));
        continue;
      }
    }
    for (auto& p : constraintPrimitives(*c, kinds)) {
      out.constraintIds.emplace(p.id, c->id());
      primitives.push_back(std::move(p));
    }
  }

  if (drag) {
    const auto it = kinds.find(drag->point);
    if (it == kinds.end() || it->second->kind() != EntityKind::Point) return out;
    Primitive x = constraint(PrimitiveType::CoordinateX, std::string(DRAG) + ":x",
                             {drag->point.str()}, {ParamValue::of(drag->to[0])});
    Primitive y = constraint(PrimitiveType::CoordinateY, std::string(DRAG) + ":y",
                             {drag->point.str()}, {ParamValue::of(drag->to[1])});
    x.temporary = true;
    y.temporary = true;
    primitives.push_back(std::move(x));
    primitives.push_back(std::move(y));
  }
  out.primitives = std::move(primitives);
  return out;
}

}  // namespace tinycad::solver_planegcs
