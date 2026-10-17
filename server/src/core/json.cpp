#include "tinycad/core/json.hpp"

#include <cmath>
#include <cstdint>
#include <string>

namespace tinycad::core {

namespace {

/** 2^53: doubles up to this magnitude hold every integer exactly. */
constexpr double kMaxSafeInteger = 9007199254740992.0;

/** The value under `key` of an object, or null when absent. */
const Json& at(const Json& object, const char* key) {
  static const Json null;
  const auto it = object.find(key);
  return it == object.end() ? null : *it;
}

Json vec2Json(Vec2 v) { return Json::array({numberJson(v[0]), numberJson(v[1])}); }

Json vec3Json(Vec3 v) {
  return Json::array({numberJson(v[0]), numberJson(v[1]), numberJson(v[2])});
}

}  // namespace

bool isFiniteNumber(const Json& v) {
  if (v.is_number_integer() || v.is_number_unsigned()) return true;
  return v.is_number_float() && std::isfinite(v.get<double>());
}

bool isWholeNumber(const Json& v) {
  if (!isFiniteNumber(v)) return false;
  const double d = numberOf(v);
  return std::trunc(d) == d;
}

double numberOf(const Json& v) { return v.get<double>(); }

Json numberJson(double value) {
  if (std::trunc(value) == value && std::abs(value) <= kMaxSafeInteger) {
    return static_cast<std::int64_t>(value);
  }
  return value;
}

std::optional<Vec2> readVec2(const Json& v) {
  if (!v.is_array() || v.size() != 2 || !isFiniteNumber(v[0]) || !isFiniteNumber(v[1])) {
    return std::nullopt;
  }
  return Vec2{numberOf(v[0]), numberOf(v[1])};
}

std::optional<Vec3> readVec3(const Json& v) {
  if (!v.is_array() || v.size() != 3) return std::nullopt;
  for (const auto& x : v) {
    if (!isFiniteNumber(x)) return std::nullopt;
  }
  return Vec3{numberOf(v[0]), numberOf(v[1]), numberOf(v[2])};
}

std::optional<Curve2> readCurve2(const Json& v) {
  if (!v.is_object() || !at(v, "kind").is_string()) return std::nullopt;
  const Json& idValue = at(v, "id");
  if (!idValue.is_null() && !idValue.is_string()) return std::nullopt;
  std::string id = idValue.is_string() ? idValue.get<std::string>() : std::string();
  const std::string kind = at(v, "kind").get<std::string>();
  if (kind == "line") {
    const auto from = readVec2(at(v, "from"));
    const auto to = readVec2(at(v, "to"));
    if (!from || !to) return std::nullopt;
    return Curve2::line(*from, *to, std::move(id));
  }
  if (kind == "arc") {
    const auto center = readVec2(at(v, "center"));
    const auto from = readVec2(at(v, "from"));
    const auto to = readVec2(at(v, "to"));
    if (!center || !from || !to || !at(v, "ccw").is_boolean()) return std::nullopt;
    return Curve2::arc(*center, *from, *to, at(v, "ccw").get<bool>(), std::move(id));
  }
  if (kind == "circle") {
    const auto center = readVec2(at(v, "center"));
    if (!center || !isFiniteNumber(at(v, "radius"))) return std::nullopt;
    return Curve2::circle(*center, numberOf(at(v, "radius")), std::move(id));
  }
  if (kind == "bspline") {
    const Json& degree = at(v, "degree");
    const Json& poles = at(v, "poles");
    const Json& knots = at(v, "knots");
    if (!isWholeNumber(degree) || !poles.is_array() || !knots.is_array()) return std::nullopt;
    const double d = numberOf(degree);
    if (std::abs(d) > 1e6) return std::nullopt;
    std::vector<Vec2> polePoints;
    for (const auto& p : poles) {
      const auto point = readVec2(p);
      if (!point) return std::nullopt;
      polePoints.push_back(*point);
    }
    std::vector<double> knotValues;
    for (const auto& k : knots) {
      if (!isFiniteNumber(k)) return std::nullopt;
      knotValues.push_back(numberOf(k));
    }
    return Curve2::bspline(static_cast<int>(d), std::move(polePoints), std::move(knotValues),
                           std::move(id));
  }
  return std::nullopt;
}

Json curve2Json(const Curve2& curve) {
  Json out = {{"kind", curve.kindName()}};
  switch (curve.kind) {
    case Curve2::Kind::Line:
      out["from"] = vec2Json(curve.from);
      out["to"] = vec2Json(curve.to);
      break;
    case Curve2::Kind::Arc:
      out["center"] = vec2Json(curve.center);
      out["from"] = vec2Json(curve.from);
      out["to"] = vec2Json(curve.to);
      out["ccw"] = curve.ccw;
      break;
    case Curve2::Kind::Circle:
      out["center"] = vec2Json(curve.center);
      out["radius"] = numberJson(curve.radius);
      break;
    case Curve2::Kind::BSpline: {
      out["degree"] = curve.degree;
      Json poles = Json::array();
      for (const Vec2& p : curve.poles) poles.push_back(vec2Json(p));
      out["poles"] = poles;
      Json knots = Json::array();
      for (double k : curve.knots) knots.push_back(numberJson(k));
      out["knots"] = knots;
      break;
    }
  }
  if (!curve.id.empty()) out["id"] = curve.id;
  return out;
}

Json planeJson(const Plane& p) {
  return {{"origin", vec3Json(p.origin)}, {"xDir", vec3Json(p.xDir)}, {"normal", vec3Json(p.normal)}};
}

std::optional<Plane> readPlane(const Json& v) {
  if (!v.is_object()) return std::nullopt;
  const auto origin = readVec3(at(v, "origin"));
  const auto xDir = readVec3(at(v, "xDir"));
  const auto normal = readVec3(at(v, "normal"));
  if (!origin || !xDir || !normal) return std::nullopt;
  return Plane{*origin, *xDir, *normal};
}

}  // namespace tinycad::core
