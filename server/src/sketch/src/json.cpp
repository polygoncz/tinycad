// JSON of entities and constraints in the TS shape (src/sketch/model.ts): the fields of the kind,
// optional ones (`construction`, `direction2`, `placement`, `reverseA`, `reverseB`) only when set,
// numbers through numberJson so that integral values are written as integers like JSON.stringify.

#include <string>

#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch {

namespace {

using core::numberJson;

Json vec2Json(const Vec2& v) { return Json::array({numberJson(v[0]), numberJson(v[1])}); }

Json idsJson(const std::vector<SketchEntityId>& ids) {
  Json out = Json::array();
  for (const auto& id : ids) out.push_back(id.str());
  return out;
}

Json numbersJson(const std::vector<double>& values) {
  Json out = Json::array();
  for (double v : values) out.push_back(numberJson(v));
  return out;
}

Json vec2sJson(const std::vector<Vec2>& points) {
  Json out = Json::array();
  for (const auto& p : points) out.push_back(vec2Json(p));
  return out;
}

Json directionJson(const PatternDirection& d) {
  return {{"angle", numberJson(d.angle)}, {"count", d.count}, {"spacing", numberJson(d.spacing)}};
}

const char* fontName(TextFont font) {
  switch (font) {
    case TextFont::Sans:
      return "sans";
    case TextFont::Serif:
      return "serif";
    case TextFont::Mono:
      break;
  }
  return "mono";
}

Json placementJson(const DimensionPlacement& p) {
  switch (p.kind) {
    case DimensionPlacement::Kind::Linear:
      return {{"kind", "linear"}, {"offset", numberJson(p.offset)}, {"along", numberJson(p.along)}};
    case DimensionPlacement::Kind::Radial:
      return {{"kind", "radial"},
              {"angle", numberJson(p.angle)},
              {"distance", numberJson(p.distance)}};
    case DimensionPlacement::Kind::Angular:
      break;
  }
  return {{"kind", "angular"}, {"radius", numberJson(p.radius)}, {"t", numberJson(p.t)}};
}

void setConstruction(Json& out, bool construction) {
  if (construction) out["construction"] = true;
}

void setPlacement(Json& out, const std::optional<DimensionPlacement>& placement) {
  if (placement) out["placement"] = placementJson(*placement);
}

}  // namespace

Json entityJson(const SketchEntity& entity) {
  Json out = {{"kind", std::string(entityKindName(entity.kind()))}, {"id", entity.id().str()}};
  switch (entity.kind()) {
    case EntityKind::Point: {
      const auto& p = entity.as<SketchPoint>();
      out["x"] = numberJson(p.x);
      out["y"] = numberJson(p.y);
      break;
    }
    case EntityKind::Line: {
      const auto& l = entity.as<SketchLine>();
      out["p1"] = l.p1.str();
      out["p2"] = l.p2.str();
      setConstruction(out, l.construction);
      break;
    }
    case EntityKind::Circle: {
      const auto& c = entity.as<SketchCircle>();
      out["center"] = c.center.str();
      out["radius"] = numberJson(c.radius);
      setConstruction(out, c.construction);
      break;
    }
    case EntityKind::Arc: {
      const auto& a = entity.as<SketchArc>();
      out["center"] = a.center.str();
      out["start"] = a.start.str();
      out["end"] = a.end.str();
      setConstruction(out, a.construction);
      break;
    }
    case EntityKind::BSpline: {
      const auto& b = entity.as<SketchBSpline>();
      out["degree"] = b.degree;
      out["poles"] = idsJson(b.poles);
      out["knots"] = numbersJson(b.knots);
      setConstruction(out, b.construction);
      break;
    }
    case EntityKind::FitSpline: {
      const auto& f = entity.as<SketchFitSpline>();
      out["degree"] = f.degree;
      out["fit"] = idsJson(f.fit);
      out["params"] = numbersJson(f.params);
      out["poles"] = vec2sJson(f.poles);
      out["knots"] = numbersJson(f.knots);
      setConstruction(out, f.construction);
      break;
    }
    case EntityKind::XLine: {
      const auto& x = entity.as<SketchXLine>();
      out["p1"] = x.p1.str();
      out["p2"] = x.p2.str();
      out["construction"] = true;
      break;
    }
    case EntityKind::Mirror: {
      const auto& m = entity.as<SketchMirror>();
      out["sources"] = idsJson(m.sources);
      out["axis"] = m.axis.str();
      break;
    }
    case EntityKind::LinearPattern: {
      const auto& p = entity.as<SketchLinearPattern>();
      out["sources"] = idsJson(p.sources);
      out["direction1"] = directionJson(p.direction1);
      if (p.direction2) out["direction2"] = directionJson(*p.direction2);
      break;
    }
    case EntityKind::CircularPattern: {
      const auto& p = entity.as<SketchCircularPattern>();
      out["sources"] = idsJson(p.sources);
      out["center"] = p.center.str();
      out["count"] = p.count;
      out["angle"] = numberJson(p.angle);
      break;
    }
    case EntityKind::Text: {
      const auto& t = entity.as<SketchText>();
      out["text"] = t.text;
      out["font"] = fontName(t.font);
      out["height"] = numberJson(t.height);
      out["baseline"] = t.baseline.str();
      Json contours = Json::array();
      for (const auto& c : t.contours) {
        Json segments = Json::array();
        for (const auto& segment : c.segments) segments.push_back(vec2sJson(segment));
        contours.push_back({{"char", c.charIndex}, {"code", c.code}, {"segments", segments}});
      }
      out["contours"] = contours;
      setConstruction(out, t.construction);
      break;
    }
  }
  return out;
}

Json constraintJson(const SketchConstraint& constraint) {
  Json out = {{"kind", std::string(constraintKindName(constraint.kind()))},
              {"id", constraint.id().str()}};
  switch (constraint.kind()) {
    case ConstraintKind::Coincident:
    case ConstraintKind::Parallel:
    case ConstraintKind::Perpendicular:
    case ConstraintKind::Equal:
    case ConstraintKind::Tangent:
    case ConstraintKind::HAlign:
    case ConstraintKind::VAlign: {
      const auto& c = constraint.as<PairConstraint>();
      out["a"] = c.a.str();
      out["b"] = c.b.str();
      break;
    }
    case ConstraintKind::Horizontal:
    case ConstraintKind::Vertical:
      out["line"] = constraint.as<LineConstraint>().line.str();
      break;
    case ConstraintKind::PointOnCurve: {
      const auto& c = constraint.as<PointOnCurveConstraint>();
      out["point"] = c.point.str();
      out["curve"] = c.curve.str();
      break;
    }
    case ConstraintKind::Midpoint: {
      const auto& c = constraint.as<MidpointConstraint>();
      out["point"] = c.point.str();
      out["line"] = c.line.str();
      break;
    }
    case ConstraintKind::Symmetric: {
      const auto& c = constraint.as<SymmetricConstraint>();
      out["a"] = c.a.str();
      out["b"] = c.b.str();
      out["axis"] = c.axis.str();
      break;
    }
    case ConstraintKind::Fix:
      out["point"] = constraint.as<FixConstraint>().point.str();
      break;
    case ConstraintKind::Distance:
    case ConstraintKind::HDistance:
    case ConstraintKind::VDistance: {
      const auto& c = constraint.as<DistanceConstraint>();
      out["a"] = c.a.str();
      out["b"] = c.b.str();
      out["value"] = numberJson(c.value);
      setPlacement(out, c.placement);
      break;
    }
    case ConstraintKind::PointLineDistance: {
      const auto& c = constraint.as<PointLineDistanceConstraint>();
      out["point"] = c.point.str();
      out["line"] = c.line.str();
      out["value"] = numberJson(c.value);
      setPlacement(out, c.placement);
      break;
    }
    case ConstraintKind::Angle: {
      const auto& c = constraint.as<AngleConstraint>();
      out["a"] = c.a.str();
      out["b"] = c.b.str();
      out["value"] = numberJson(c.value);
      if (c.reverseA) out["reverseA"] = true;
      if (c.reverseB) out["reverseB"] = true;
      setPlacement(out, c.placement);
      break;
    }
    case ConstraintKind::Radius:
    case ConstraintKind::Diameter: {
      const auto& c = constraint.as<RadialConstraint>();
      out["curve"] = c.curve.str();
      out["value"] = numberJson(c.value);
      setPlacement(out, c.placement);
      break;
    }
    case ConstraintKind::Offset: {
      const auto& c = constraint.as<OffsetConstraint>();
      Json pairs = Json::array();
      for (const auto& p : c.pairs) {
        pairs.push_back({{"source", p.source.str()}, {"copy", p.copy.str()}});
      }
      out["pairs"] = pairs;
      out["value"] = numberJson(c.value);
      setPlacement(out, c.placement);
      break;
    }
  }
  return out;
}

Json Sketch::entitiesJson() const {
  Json out = Json::array();
  for (const auto& e : entities_) out.push_back(entityJson(*e));
  return out;
}

Json Sketch::constraintsJson() const {
  Json out = Json::array();
  for (const auto& c : constraints_) out.push_back(constraintJson(*c));
  return out;
}

}  // namespace tinycad::sketch
