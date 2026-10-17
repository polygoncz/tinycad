// 2D geometry of sketch curves for regions and the kernel (spec 12 "Křivky pro oblasti a odvozená
// id"): port of curve2 and regionCurves of src/sketch/geometry.ts and of pointsById.

#include <cmath>
#include <string>

#include "derived.hpp"

namespace tinycad::sketch {

namespace detail {

PointMap pointsById(const std::vector<EntityPtr>& entities) {
  PointMap points;
  for (const auto& e : entities) {
    if (e->kind() == EntityKind::Point) points[e->id()] = &e->as<SketchPoint>();
  }
  return points;
}

std::vector<SketchEntityId> curvePoints(const SketchEntity& curve) {
  switch (curve.kind()) {
    case EntityKind::Line:
      return {curve.as<SketchLine>().p1, curve.as<SketchLine>().p2};
    case EntityKind::XLine:
      return {curve.as<SketchXLine>().p1, curve.as<SketchXLine>().p2};
    case EntityKind::Circle:
      return {curve.as<SketchCircle>().center};
    case EntityKind::Arc: {
      const auto& a = curve.as<SketchArc>();
      return {a.center, a.start, a.end};
    }
    case EntityKind::BSpline:
      return curve.as<SketchBSpline>().poles;
    case EntityKind::FitSpline:
      return curve.as<SketchFitSpline>().fit;
    default:
      break;
  }
  TINYCAD_ASSERT(false, "curvePoints: '" + curve.id().str() + "' is not a curve");
  return {};
}

Curve2 curveOf(const SketchEntity& curve, const PointMap& points) {
  const auto at = [&](const SketchEntityId& id) -> Vec2 {
    const auto it = points.find(id);
    TINYCAD_ASSERT(it != points.end(), "curve2: curve '" + curve.id().str() +
                                           "' refers to a missing point '" + id.str() + "'");
    return {it->second->x, it->second->y};
  };
  const std::string& id = curve.id().str();
  switch (curve.kind()) {
    case EntityKind::Line: {
      const auto& l = curve.as<SketchLine>();
      return Curve2::line(at(l.p1), at(l.p2), id);
    }
    case EntityKind::Circle: {
      const auto& c = curve.as<SketchCircle>();
      return Curve2::circle(at(c.center), c.radius, id);
    }
    case EntityKind::Arc: {
      const auto& a = curve.as<SketchArc>();
      return Curve2::arc(at(a.center), at(a.start), at(a.end), true, id);
    }
    case EntityKind::BSpline: {
      const auto& b = curve.as<SketchBSpline>();
      std::vector<Vec2> poles;
      for (const auto& p : b.poles) poles.push_back(at(p));
      return Curve2::bspline(b.degree, std::move(poles), b.knots, id);
    }
    case EntityKind::FitSpline: {
      const auto& f = curve.as<SketchFitSpline>();
      return Curve2::bspline(f.degree, f.poles, f.knots, id);
    }
    case EntityKind::XLine: {
      const auto& x = curve.as<SketchXLine>();
      const Vec2 p1 = at(x.p1);
      const Vec2 p2 = at(x.p2);
      const Vec2 p1p2 = {p2[0] - p1[0], p2[1] - p1[1]};
      const Vec2 m = {p1[0] + p1p2[0] * 0.5, p1[1] + p1p2[1] * 0.5};
      // p1 ≠ p2 (parse), so the direction is defined.
      const double length = std::hypot(p1p2[0], p1p2[1]);
      TINYCAD_ASSERT(length > 0, "Cannot normalize a zero vector");
      const Vec2 d = {p1p2[0] / length, p1p2[1] / length};
      return Curve2::line({m[0] + d[0] * -XLINE_EXTENT, m[1] + d[1] * -XLINE_EXTENT},
                          {m[0] + d[0] * XLINE_EXTENT, m[1] + d[1] * XLINE_EXTENT}, id);
    }
    default:
      break;
  }
  TINYCAD_ASSERT(false, "curve2: '" + id + "' is not a curve");
  return {};
}

}  // namespace detail

namespace {

/**
 * Whether an entity bounds regions. Exhaustive on purpose: a new kind must decide here. An xline
 * is always construction (M31); a pattern or a text is a recipe, regionCurves adds its curves.
 */
bool isRegionCurve(const SketchEntity& e) {
  switch (e.kind()) {
    case EntityKind::Point:
    case EntityKind::XLine:
    case EntityKind::Mirror:
    case EntityKind::LinearPattern:
    case EntityKind::CircularPattern:
    case EntityKind::Text:
      return false;
    case EntityKind::Line:
      return !e.as<SketchLine>().construction;
    case EntityKind::Circle:
      return !e.as<SketchCircle>().construction;
    case EntityKind::Arc:
      return !e.as<SketchArc>().construction;
    case EntityKind::BSpline:
      return !e.as<SketchBSpline>().construction;
    case EntityKind::FitSpline:
      return !e.as<SketchFitSpline>().construction;
  }
  return false;
}

}  // namespace

Curve2 Sketch::curve2(const SketchEntity& curve) const {
  return detail::curveOf(curve, detail::pointsById(entities_));
}

std::vector<Curve2> Sketch::regionCurves() const {
  const std::vector<EntityPtr> copies = patternCopies();
  detail::PointMap points = detail::pointsById(entities_);
  for (const auto& copy : copies) {
    if (copy->kind() == EntityKind::Point) points[copy->id()] = &copy->as<SketchPoint>();
  }
  std::vector<Curve2> out;
  for (const auto& e : entities_) {
    if (isRegionCurve(*e)) out.push_back(detail::curveOf(*e, points));
  }
  for (const auto& e : copies) {
    if (isRegionCurve(*e)) out.push_back(detail::curveOf(*e, points));
  }
  // A construction text bounds nothing; its baseline (usually construction) stays for the others.
  std::vector<EntityPtr> withoutConstructionTexts;
  for (const auto& e : entities_) {
    if (e->kind() != EntityKind::Text || !e->as<SketchText>().construction) {
      withoutConstructionTexts.push_back(e);
    }
  }
  for (auto& c : detail::textCurvesOf(withoutConstructionTexts)) out.push_back(std::move(c));
  return out;
}

}  // namespace tinycad::sketch
