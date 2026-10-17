// Shape and invariant checks of sketch data (spec 12 "Kontrola dat"): port of src/sketch/parse.ts
// and of the value rules textParamsValid / patternParamsValid of src/sketch/model.ts. The checks
// run on the raw JSON exactly as in TS (same order, same tolerances); only data that passed every
// check is turned into the typed entities and constraints (readEntity, readConstraint).

#include <algorithm>
#include <cmath>
#include <map>
#include <numbers>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch {

namespace {

using core::isFiniteNumber;
using core::isWholeNumber;
using core::numberOf;

/** Relative tolerance of equal arc radii and the smallest arc radius (spec 12). */
constexpr double ARC_RADIUS_TOLERANCE = 1e-6;
constexpr double MIN_ARC_RADIUS = 1e-9;
/** The fewest and most poles of a segment of a letter outline (a line … a cubic Bézier curve). */
constexpr std::size_t MIN_TEXT_POLES = 2;
constexpr std::size_t MAX_TEXT_POLES = 4;
/** Relative tolerance of joined and closed letter outlines (spec 12 "Text ve skice (M37)"). */
constexpr double TEXT_JOIN_TOLERANCE = 1e-9;
/** The highest spline degree (cubic); a spline's degree = min(MAX_SPLINE_DEGREE, points − 1). */
constexpr int MAX_SPLINE_DEGREE = 3;

using Keys = std::vector<std::string>;

// ---------------------------------------------------------------------------------------------
// JSON helpers

/** The value under `key`, or nullptr when the object has no such key (undefined in TS). */
const Json* field(const Json& object, const std::string& key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

bool isId(const Json* v) { return v != nullptr && v->is_string() && !v->get_ref<const std::string&>().empty(); }

bool isFinite(const Json* v) { return v != nullptr && isFiniteNumber(*v); }

/** typeof v === 'number' (any JSON number; finiteness is checked by the value rules). */
bool isNumber(const Json* v) { return v != nullptr && v->is_number(); }

/** A finite number > 0. */
bool isPositive(const Json* v) { return isFinite(v) && numberOf(*v) > 0; }

const std::string& str(const Json* v) { return v->get_ref<const std::string&>(); }

/** The string of a field, or "" when it is no string (a kind that matches nothing). */
std::string kindOf(const Json* target) {
  if (target == nullptr) return {};
  const Json* kind = field(*target, "kind");
  return kind != nullptr && kind->is_string() ? str(kind) : std::string();
}

/** Strict equality of two raw values; a missing value (undefined) equals nothing. */
bool same(const Json* a, const Json* b) { return a != nullptr && b != nullptr && *a == *b; }

/** The required keys are present and no other key than kind, required and optional. */
bool hasExactly(const Json& item, const Keys& required, const Keys& optional) {
  for (const auto& key : required) {
    if (!item.contains(key)) return false;
  }
  for (const auto& [key, value] : item.items()) {
    if (key == "kind") continue;
    const bool allowed = std::find(required.begin(), required.end(), key) != required.end() ||
                         std::find(optional.begin(), optional.end(), key) != optional.end();
    if (!allowed) return false;
  }
  return true;
}

/** An id usable in a derived id: no ':' and no ','. */
bool plainId(const Json* v) {
  return isId(v) && str(v).find(':') == std::string::npos && str(v).find(',') == std::string::npos;
}

// ---------------------------------------------------------------------------------------------
// Text values (textParamsValid)

/** The code points of a UTF-8 string (Array.from in TS); a broken sequence counts its bytes. */
std::vector<char32_t> codePoints(const std::string& text) {
  std::vector<char32_t> out;
  std::size_t i = 0;
  while (i < text.size()) {
    const auto byte = static_cast<unsigned char>(text[i]);
    std::size_t length = 1;
    char32_t cp = byte;
    if (byte >= 0xF0) {
      length = 4;
      cp = byte & 0x07U;
    } else if (byte >= 0xE0) {
      length = 3;
      cp = byte & 0x0FU;
    } else if (byte >= 0xC0) {
      length = 2;
      cp = byte & 0x1FU;
    }
    if (i + length > text.size()) length = 1;
    for (std::size_t k = 1; k < length; ++k) {
      cp = (cp << 6) | (static_cast<unsigned char>(text[i + k]) & 0x3FU);
    }
    out.push_back(length == 1 ? char32_t(byte) : cp);
    i += length;
  }
  return out;
}

/** \p{Cc}: C0 controls, DEL and C1 controls. */
bool isControl(char32_t cp) { return cp <= 0x1F || (cp >= 0x7F && cp <= 0x9F); }

bool fontValid(const std::string& font) {
  return font == "sans" || font == "serif" || font == "mono";
}

/**
 * The values of a text the user sets (M37): 1 … MAX_TEXT_LENGTH code points without control
 * characters, a known font, a finite height > 0.
 */
bool textParamsValid(const std::string& text, const std::string& font, double height) {
  const auto chars = codePoints(text);
  const bool noControl = std::none_of(chars.begin(), chars.end(), isControl);
  return !chars.empty() && chars.size() <= static_cast<std::size_t>(MAX_TEXT_LENGTH) &&
         noControl && fontValid(font) && std::isfinite(height) && height > 0;
}

// ---------------------------------------------------------------------------------------------
// Pattern values (patternParamsValid)

/** An integer number of instances, 2 … MAX_PATTERN_COUNT. */
bool countValid(const Json* count) {
  return isWholeNumber(*count) && numberOf(*count) >= 2 && numberOf(*count) <= MAX_PATTERN_COUNT;
}

/** A direction whose shape is checked: count, spacing finite > 0, angle finite. */
bool directionValid(const Json& d) {
  return countValid(field(d, "count")) && isPositive(field(d, "spacing")) &&
         isFinite(field(d, "angle"));
}

/** The values of the parameters of a pattern whose kind, fields and number types are checked. */
bool patternParamsValid(const Json& item, const std::string& kind) {
  if (kind == "linearPattern") {
    const Json* d2 = field(item, "direction2");
    return directionValid(item.at("direction1")) && (d2 == nullptr || directionValid(*d2));
  }
  if (kind == "circularPattern") {
    const Json* angle = field(item, "angle");
    return countValid(field(item, "count")) && isFinite(angle) && numberOf(*angle) != 0 &&
           std::abs(numberOf(*angle)) <= 2 * std::numbers::pi + FULL_CIRCLE_TOLERANCE;
  }
  return true;  // A mirror has no parameters.
}

// ---------------------------------------------------------------------------------------------
// The checks of parseSketchData

/** id → the first item with that id (a duplicate is reported at itself). */
using Targets = std::unordered_map<std::string, const Json*>;
using Used = std::unordered_set<std::string>;

class SketchChecker {
 public:
  explicit SketchChecker(const Json* entities) {
    if (entities == nullptr) return;
    for (const auto& item : *entities) {
      const Json* id = item.is_object() ? field(item, "id") : nullptr;
      if (isId(id)) targets_.emplace(str(id), &item);
    }
  }

  bool entityValid(const Json& item);
  bool constraintValid(const Json& item);

 private:
  /** The target of a reference, or nullptr. */
  [[nodiscard]] const Json* target(const Json* ref) const {
    if (ref == nullptr || !ref->is_string()) return nullptr;
    const auto it = targets_.find(str(ref));
    return it == targets_.end() ? nullptr : it->second;
  }
  /** The target when it is a point. */
  [[nodiscard]] const Json* point(const Json* ref) const {
    const Json* t = target(ref);
    return kindOf(t) == "point" ? t : nullptr;
  }
  /** A line or an xline (M31): a mirror axis, a text baseline. */
  [[nodiscard]] bool isCarrier(const Json* ref) const {
    const std::string kind = kindOf(target(ref));
    return kind == "line" || kind == "xline";
  }

  /** True when the id is a non-empty string not used before; remembers it either way. */
  bool claimId(const Json* id) {
    if (!isId(id)) return false;
    return used_.insert(str(id)).second;
  }

  [[nodiscard]] bool arcRadiiValid(const Json& center, const Json& start, const Json& end) const;
  [[nodiscard]] int splinePointCount(const Json* refs) const;
  [[nodiscard]] bool patternValid(const Json& item, const Json* anchor) const;
  [[nodiscard]] bool offsetPairsValid(const Json* pairs) const;
  [[nodiscard]] bool isEndOf(const Json* point, const Json* line) const;

  Targets targets_;
  Used used_;
};

bool isCurveKind(const std::string& kind) {
  return kind == "line" || kind == "circle" || kind == "arc" || kind == "bspline" ||
         kind == "fitSpline" || kind == "xline";
}

bool isRound(const std::string& kind) { return kind == "circle" || kind == "arc"; }

bool isRecipe(const std::string& kind) {
  return kind == "mirror" || kind == "linearPattern" || kind == "circularPattern" ||
         kind == "text";
}

/** The required and optional fields of an entity kind besides `kind`; false for an unknown kind. */
bool entityFields(const std::string& kind, Keys& required, Keys& optional) {
  static const std::map<std::string, std::pair<Keys, Keys>> fields = {
      {"point", {{"id", "x", "y"}, {}}},
      {"line", {{"id", "p1", "p2"}, {"construction"}}},
      {"circle", {{"id", "center", "radius"}, {"construction"}}},
      {"arc", {{"id", "center", "start", "end"}, {"construction"}}},
      {"bspline", {{"id", "degree", "poles", "knots"}, {"construction"}}},
      {"fitSpline", {{"id", "degree", "fit", "params", "poles", "knots"}, {"construction"}}},
      // Always construction (M31): the flag is required and must be true.
      {"xline", {{"id", "p1", "p2", "construction"}, {}}},
      {"mirror", {{"id", "sources", "axis"}, {}}},
      {"linearPattern", {{"id", "sources", "direction1"}, {"direction2"}}},
      {"circularPattern", {{"id", "sources", "center", "count", "angle"}, {}}},
      {"text", {{"id", "text", "font", "height", "baseline", "contours"}, {"construction"}}},
  };
  const auto it = fields.find(kind);
  if (it == fields.end()) return false;
  required = it->second.first;
  optional = it->second.second;
  return true;
}

/**
 * Clamped knots of n poles: length n + degree + 1, the first degree + 1 are 0, the last
 * degree + 1 are 1, the interior ones lie in (0, 1), do not decrease and none repeats more than
 * degree times.
 */
bool knotsValid(const Json* knots, int n, int degree) {
  if (knots == nullptr || !knots->is_array() ||
      knots->size() != static_cast<std::size_t>(n + degree + 1)) {
    return false;
  }
  for (const auto& k : *knots) {
    if (!isFiniteNumber(k)) return false;
  }
  int run = 0;
  for (int i = 0; i < static_cast<int>(knots->size()); ++i) {
    const double k = numberOf((*knots)[i]);
    if (i <= degree) {
      if (k != 0) return false;
    } else if (i >= n) {
      if (k != 1) return false;
    } else {
      const double previous = numberOf((*knots)[i - 1]);
      if (k <= 0 || k >= 1 || k < previous) return false;
      run = k == previous ? run + 1 : 1;
      if (run > degree) return false;
    }
  }
  return true;
}

/** n parameters, increasing, first 0, last 1. */
bool paramsValid(const Json* params, int n) {
  if (params == nullptr || !params->is_array() || params->size() != static_cast<std::size_t>(n)) {
    return false;
  }
  for (const auto& t : *params) {
    if (!isFiniteNumber(t)) return false;
  }
  if (numberOf((*params)[0]) != 0 || numberOf((*params)[n - 1]) != 1) return false;
  for (int i = 1; i < n; ++i) {
    if (!(numberOf((*params)[i]) > numberOf((*params)[i - 1]))) return false;
  }
  return true;
}

/** n pairs of finite coordinates. */
bool polesValid(const Json* poles, int n) {
  if (poles == nullptr || !poles->is_array() || poles->size() != static_cast<std::size_t>(n)) {
    return false;
  }
  return std::all_of(poles->begin(), poles->end(),
                     [](const Json& p) { return core::readVec2(p).has_value(); });
}

/** The shape of a direction of a linear pattern: exactly angle, count and spacing, all numbers. */
bool directionShape(const Json* v) {
  return v != nullptr && v->is_object() && hasExactly(*v, {"angle", "count", "spacing"}, {}) &&
         isNumber(field(*v, "angle")) && isNumber(field(*v, "count")) &&
         isNumber(field(*v, "spacing"));
}

/** Equal coordinates within TEXT_JOIN_TOLERANCE · max(1, |coordinate|). */
bool samePole(const Vec2& a, const Vec2& b) {
  for (int i = 0; i < 2; ++i) {
    const double v = a[i];
    const double w = b[i];
    if (!(std::abs(v - w) <= TEXT_JOIN_TOLERANCE * std::max({1.0, std::abs(v), std::abs(w)}))) {
      return false;
    }
  }
  return true;
}

/** ≥ 1 segment of 2–4 finite poles, each starting where the previous ends, the last ending at the first. */
bool loopValid(const Json* segments) {
  if (segments == nullptr || !segments->is_array() || segments->empty()) return false;
  std::vector<std::vector<Vec2>> poles;
  for (const auto& segment : *segments) {
    if (!segment.is_array()) return false;
    if (segment.size() < MIN_TEXT_POLES || segment.size() > MAX_TEXT_POLES) return false;
    std::vector<Vec2> pairs;
    for (const auto& p : segment) {
      const auto pair = core::readVec2(p);
      if (!pair) return false;
      pairs.push_back(*pair);
    }
    poles.push_back(std::move(pairs));
  }
  for (std::size_t i = 0; i < poles.size(); ++i) {
    const auto& next = poles[(i + 1) % poles.size()];
    if (!samePole(poles[i].back(), next.front())) return false;
  }
  return true;
}

/**
 * The outlines of a text (M37): every contour belongs to a character of the string (its index in
 * code points and its code point) and is a closed chain of 2–4-pole segments with finite
 * coordinates.
 */
bool contoursValid(const std::string& text, const Json* contours) {
  if (contours == nullptr || !contours->is_array()) return false;
  const auto chars = codePoints(text);
  for (const auto& c : *contours) {
    if (!c.is_object() || !hasExactly(c, {"char", "code", "segments"}, {})) return false;
    const Json* index = field(c, "char");
    if (!isWholeNumber(*index)) return false;
    const double i = numberOf(*index);
    if (i < 0 || i >= static_cast<double>(chars.size())) return false;
    const Json* code = field(c, "code");
    if (!isFinite(code) || numberOf(*code) != static_cast<double>(chars[static_cast<std::size_t>(i)])) {
      return false;
    }
    if (!loopValid(field(c, "segments"))) return false;
  }
  return true;
}

/** The coordinates of a raw point, or nullopt when they are not finite numbers. */
std::optional<Vec2> coordinates(const Json& point) {
  const Json* x = field(point, "x");
  const Json* y = field(point, "y");
  if (!isFinite(x) || !isFinite(y)) return std::nullopt;
  return Vec2{numberOf(*x), numberOf(*y)};
}

bool SketchChecker::arcRadiiValid(const Json& center, const Json& start, const Json& end) const {
  const auto c = coordinates(center);
  const auto s = coordinates(start);
  const auto e = coordinates(end);
  // A point with bad coordinates is reported at itself; the arc cannot be judged.
  if (!c || !s || !e) return true;
  const double rStart = std::hypot((*s)[0] - (*c)[0], (*s)[1] - (*c)[1]);
  const double rEnd = std::hypot((*e)[0] - (*c)[0], (*e)[1] - (*c)[1]);
  return rStart > MIN_ARC_RADIUS &&
         std::abs(rEnd - rStart) <= ARC_RADIUS_TOLERANCE * std::max(1.0, rStart);
}

/** The number of spline points when they are ≥ 2 distinct references to points, else 0. */
int SketchChecker::splinePointCount(const Json* refs) const {
  if (refs == nullptr || !refs->is_array() || refs->size() < 2) return 0;
  std::set<std::string> distinct;
  for (const auto& ref : *refs) {
    if (point(&ref) == nullptr) return 0;
    distinct.insert(str(&ref));
  }
  return distinct.size() == refs->size() ? static_cast<int>(refs->size()) : 0;
}

/**
 * The common rules of a mirror or pattern (M36): its id and the ids of its sources have no ':' or
 * ',' (derived ids stay unambiguous); the sources are a non-empty list of distinct points or
 * curves of the sketch, without the axis or center (`anchor`).
 */
bool SketchChecker::patternValid(const Json& item, const Json* anchor) const {
  const Json* sources = field(item, "sources");
  if (!plainId(field(item, "id")) || sources == nullptr || !sources->is_array() ||
      sources->empty()) {
    return false;
  }
  std::set<std::string> distinct;
  for (const auto& ref : *sources) {
    if (!plainId(&ref)) return false;
    if (same(&ref, anchor)) return false;
    distinct.insert(str(&ref));
    const std::string kind = kindOf(target(&ref));
    if (kind != "point" && !isCurveKind(kind)) return false;
  }
  return distinct.size() == sources->size();
}

bool SketchChecker::entityValid(const Json& item) {
  if (!item.is_object()) return false;
  const bool idFresh = claimId(field(item, "id"));
  const std::string kind = kindOf(&item);
  Keys required;
  Keys optional;
  if (!entityFields(kind, required, optional) || !hasExactly(item, required, optional)) {
    return false;
  }
  if (!idFresh) return false;
  const Json* construction = field(item, "construction");
  if (construction != nullptr && *construction != true) return false;

  if (kind == "point") return isFinite(field(item, "x")) && isFinite(field(item, "y"));
  if (kind == "line" || kind == "xline") {
    const Json* p1 = field(item, "p1");
    const Json* p2 = field(item, "p2");
    return point(p1) != nullptr && point(p2) != nullptr && *p1 != *p2;
  }
  if (kind == "circle") {
    return point(field(item, "center")) != nullptr && isPositive(field(item, "radius"));
  }
  if (kind == "arc") {
    const Json* c = point(field(item, "center"));
    const Json* s = point(field(item, "start"));
    const Json* e = point(field(item, "end"));
    if (c == nullptr || s == nullptr || e == nullptr) return false;
    const std::set<std::string> ids = {str(field(item, "center")), str(field(item, "start")),
                                       str(field(item, "end"))};
    if (ids.size() != 3) return false;
    return arcRadiiValid(*c, *s, *e);
  }
  if (kind == "bspline") {
    const int n = splinePointCount(field(item, "poles"));
    if (n == 0) return false;
    const int degree = std::min(MAX_SPLINE_DEGREE, n - 1);
    const Json* d = field(item, "degree");
    return isFinite(d) && numberOf(*d) == degree && knotsValid(field(item, "knots"), n, degree);
  }
  if (kind == "fitSpline") {
    const int n = splinePointCount(field(item, "fit"));
    if (n == 0) return false;
    const int degree = std::min(MAX_SPLINE_DEGREE, n - 1);
    const Json* d = field(item, "degree");
    return isFinite(d) && numberOf(*d) == degree && paramsValid(field(item, "params"), n) &&
           polesValid(field(item, "poles"), n) && knotsValid(field(item, "knots"), n, degree);
  }
  if (kind == "mirror") {
    const Json* axis = field(item, "axis");
    return patternValid(item, axis) && isCarrier(axis);
  }
  if (kind == "linearPattern") {
    const Json* d2 = field(item, "direction2");
    return patternValid(item, nullptr) && directionShape(field(item, "direction1")) &&
           (d2 == nullptr || directionShape(d2)) && patternParamsValid(item, kind);
  }
  if (kind == "circularPattern") {
    const Json* center = field(item, "center");
    return patternValid(item, center) && point(center) != nullptr &&
           isNumber(field(item, "count")) && isNumber(field(item, "angle")) &&
           patternParamsValid(item, kind);
  }
  if (kind == "text") {
    const Json* text = field(item, "text");
    const Json* font = field(item, "font");
    const Json* height = field(item, "height");
    return plainId(field(item, "id")) && isCarrier(field(item, "baseline")) &&
           text->is_string() && font->is_string() && isNumber(height) &&
           textParamsValid(str(text), str(font), numberOf(*height)) &&
           contoursValid(str(text), field(item, "contours"));
  }
  return false;
}

// Constraints

/**
 * Entity kind groups a constraint field may refer to: `line` a line with its length and ends,
 * `carrier` a line or an xline taken as its infinite carrier line (M31).
 */
enum class Need { Point, Line, Carrier, Round, Curve, Value, Pairs };

struct FieldNeed {
  std::string name;
  Need need;
};

/** The fields of each constraint kind besides `kind` and `id`, in the TS order. */
const std::vector<FieldNeed>* constraintFields(const std::string& kind) {
  static const std::map<std::string, std::vector<FieldNeed>> fields = {
      {"coincident", {{"a", Need::Point}, {"b", Need::Point}}},
      {"horizontal", {{"line", Need::Carrier}}},
      {"vertical", {{"line", Need::Carrier}}},
      {"parallel", {{"a", Need::Carrier}, {"b", Need::Carrier}}},
      {"perpendicular", {{"a", Need::Carrier}, {"b", Need::Carrier}}},
      {"equal", {{"a", Need::Line}, {"b", Need::Line}}},
      {"tangent", {{"a", Need::Line}, {"b", Need::Line}}},
      {"pointOnCurve", {{"point", Need::Point}, {"curve", Need::Curve}}},
      {"midpoint", {{"point", Need::Point}, {"line", Need::Line}}},
      {"hAlign", {{"a", Need::Point}, {"b", Need::Point}}},
      {"vAlign", {{"a", Need::Point}, {"b", Need::Point}}},
      {"symmetric", {{"a", Need::Point}, {"b", Need::Point}, {"axis", Need::Carrier}}},
      {"fix", {{"point", Need::Point}}},
      {"distance", {{"a", Need::Point}, {"b", Need::Point}, {"value", Need::Value}}},
      {"hDistance", {{"a", Need::Point}, {"b", Need::Point}, {"value", Need::Value}}},
      {"vDistance", {{"a", Need::Point}, {"b", Need::Point}, {"value", Need::Value}}},
      {"pointLineDistance",
       {{"point", Need::Point}, {"line", Need::Carrier}, {"value", Need::Value}}},
      {"angle", {{"a", Need::Carrier}, {"b", Need::Carrier}, {"value", Need::Value}}},
      {"radius", {{"curve", Need::Round}, {"value", Need::Value}}},
      {"diameter", {{"curve", Need::Round}, {"value", Need::Value}}},
      {"offset", {{"pairs", Need::Pairs}, {"value", Need::Value}}},
  };
  const auto it = fields.find(kind);
  return it == fields.end() ? nullptr : &it->second;
}

/** The placement kind of each dimension kind (spec 12 "Kóty (M28)"); "" = not a dimension. */
std::string placementKind(const std::string& kind) {
  if (kind == "distance" || kind == "hDistance" || kind == "vDistance" ||
      kind == "pointLineDistance" || kind == "offset") {
    return "linear";
  }
  if (kind == "angle") return "angular";
  if (kind == "radius" || kind == "diameter") return "radial";
  return {};
}

/** A placement of the given kind with finite numbers in range and nothing else. */
bool placementValid(const Json& v, const std::string& kind) {
  if (!v.is_object() || kindOf(&v) != kind || kind.empty()) return false;
  if (kind == "linear") {
    return hasExactly(v, {"offset", "along"}, {}) && isFinite(field(v, "offset")) &&
           isFinite(field(v, "along"));
  }
  if (kind == "radial") {
    return hasExactly(v, {"angle", "distance"}, {}) && isFinite(field(v, "angle")) &&
           isPositive(field(v, "distance"));
  }
  // angular
  const Json* t = field(v, "t");
  return hasExactly(v, {"radius", "t"}, {}) && isPositive(field(v, "radius")) && isFinite(t) &&
         numberOf(*t) >= 0 && numberOf(*t) <= 1;
}

bool matches(Need need, const std::string& kind) {
  switch (need) {
    case Need::Point:
      return kind == "point";
    case Need::Line:
      return kind == "line";
    case Need::Carrier:
      return kind == "line" || kind == "xline";
    case Need::Round:
      return isRound(kind);
    case Need::Curve:
      return isCurveKind(kind);
    case Need::Value:
    case Need::Pairs:
      break;
  }
  return false;
}

/** Whether the point id is one of the defining points of the (raw) curve. */
bool definesCurve(const Json* point, const Json& curve) {
  const std::string kind = kindOf(&curve);
  Keys fields;
  if (kind == "line" || kind == "xline") fields = {"p1", "p2"};
  if (kind == "circle") fields = {"center"};
  if (kind == "arc") fields = {"center", "start", "end"};
  if (kind == "bspline") fields = {"poles"};
  if (kind == "fitSpline") fields = {"fit"};
  for (const auto& name : fields) {
    const Json* v = field(curve, name);
    if (v == nullptr) continue;
    if (v->is_array()) {
      for (const auto& p : *v) {
        if (same(&p, point)) return true;
      }
    } else if (same(v, point)) {
      return true;
    }
  }
  return false;
}

/**
 * equal: two lines or two rounds (an xline has no length); tangent: a line or an xline and a
 * round (any order) or two rounds.
 */
bool pairAllowed(const std::string& kind, const std::string& a, const std::string& b) {
  const int rounds = int(isRound(a)) + int(isRound(b));
  if (kind == "equal") return (a == "line" && b == "line") || rounds == 2;
  const auto carrier = [](const std::string& k) { return k == "line" || k == "xline"; };
  const int carriers = int(carrier(a)) + int(carrier(b));
  return rounds == 2 || (carriers == 1 && rounds == 1);
}

/**
 * tangent (M29): a line and a spline (either order) where the line shares a point with an end of
 * the spline (the first or last pole of a bspline, fit point of a fitSpline).
 */
bool lineAtSplineEnd(const std::vector<const Json*>& pair) {
  if (pair.size() != 2) return false;
  const Json* line = nullptr;
  const Json* spline = nullptr;
  for (const Json* t : pair) {
    const std::string kind = kindOf(t);
    if (line == nullptr && kind == "line") line = t;
    if (spline == nullptr && (kind == "bspline" || kind == "fitSpline")) spline = t;
  }
  if (line == nullptr || spline == nullptr) return false;
  const Json* points = field(*spline, kindOf(spline) == "bspline" ? "poles" : "fit");
  // The spline itself is checked as an entity; a malformed one cannot be judged here.
  if (points == nullptr || !points->is_array() || points->empty()) return false;
  const Json* first = &points->front();
  const Json* last = &points->back();
  const Json* p1 = field(*line, "p1");
  const Json* p2 = field(*line, "p2");
  return same(first, p1) || same(last, p1) || same(first, p2) || same(last, p2);
}

/** True when the point is p1 or p2 of the line or the xline. */
bool SketchChecker::isEndOf(const Json* point, const Json* line) const {
  const Json* t = target(line);
  return t != nullptr && (same(field(*t, "p1"), point) || same(field(*t, "p2"), point));
}

/**
 * The pairs of an offset (M35): a non-empty list of { source, copy }; every curve at most once in
 * all pairs (so a copy is no source); line → line, arc → arc or circle → circle with the same
 * centre point. A spline has no pair (its offset is baked).
 */
bool SketchChecker::offsetPairsValid(const Json* pairs) const {
  if (pairs == nullptr || !pairs->is_array() || pairs->empty()) return false;
  std::vector<Json> seen;
  const auto wasSeen = [&seen](const Json& v) {
    return std::find(seen.begin(), seen.end(), v) != seen.end();
  };
  for (const auto& pair : *pairs) {
    if (!pair.is_object() || !hasExactly(pair, {"source", "copy"}, {})) return false;
    const Json& source = pair.at("source");
    const Json& copy = pair.at("copy");
    if (wasSeen(source) || wasSeen(copy) || source == copy) return false;
    seen.push_back(source);
    seen.push_back(copy);
    const Json* s = target(&source);
    const Json* c = target(&copy);
    if (s == nullptr || c == nullptr || kindOf(s) != kindOf(c)) return false;
    const std::string kind = kindOf(s);
    if (kind == "line") continue;
    if (!((kind == "arc" || kind == "circle") && same(field(*s, "center"), field(*c, "center")))) {
      return false;
    }
  }
  return true;
}

bool SketchChecker::constraintValid(const Json& item) {
  if (!item.is_object()) return false;
  const bool idFresh = claimId(field(item, "id"));
  const std::string kind = kindOf(&item);
  const std::vector<FieldNeed>* fields = constraintFields(kind);
  if (fields == nullptr) return false;
  const std::string placement = placementKind(kind);
  Keys optional;
  if (!placement.empty()) optional.emplace_back("placement");
  if (kind == "angle") {
    optional.emplace_back("reverseA");
    optional.emplace_back("reverseB");
  }
  Keys required = {"id"};
  for (const auto& f : *fields) required.push_back(f.name);
  if (!hasExactly(item, required, optional)) return false;
  if (!idFresh) return false;
  for (const char* flag : {"reverseA", "reverseB"}) {
    const Json* v = field(item, flag);
    if (v != nullptr && *v != true) return false;
  }
  const Json* placementValue = field(item, "placement");
  if (placementValue != nullptr && !placementValid(*placementValue, placement)) return false;
  if (kind == "angle") {
    const Json* value = field(item, "value");
    if (!(isFinite(value) && numberOf(*value) < std::numbers::pi)) return false;
  }

  std::vector<std::string> refKinds;
  std::vector<const Json*> refs;
  std::vector<const Json*> refTargets;
  for (const auto& f : *fields) {
    const Json* v = field(item, f.name);
    if (f.need == Need::Value) {
      if (!isPositive(v)) return false;
      continue;
    }
    if (f.need == Need::Pairs) {
      if (!offsetPairsValid(v)) return false;
      continue;
    }
    const Json* t = target(v);
    const Json* targetKind = t == nullptr ? nullptr : field(*t, "kind");
    if (targetKind == nullptr || !targetKind->is_string()) return false;
    refKinds.push_back(str(targetKind));
    refs.push_back(v);
    refTargets.push_back(t);
  }
  if (refs.size() == 2 && *refs[0] == *refs[1]) return false;
  // Mirrors, patterns and texts are recipes: no constraint refers to them (M36, M37).
  if (std::any_of(refKinds.begin(), refKinds.end(), isRecipe)) return false;
  if (kind == "tangent" && lineAtSplineEnd(refTargets)) return true;
  if (kind == "equal" || kind == "tangent") return pairAllowed(kind, refKinds[0], refKinds[1]);
  if (kind == "pointLineDistance" && isEndOf(field(item, "point"), field(item, "line"))) {
    return false;
  }
  std::size_t refIndex = 0;
  for (const auto& f : *fields) {
    if (f.need == Need::Value || f.need == Need::Pairs) continue;
    if (!matches(f.need, refKinds[refIndex++])) return false;
  }
  if (kind == "symmetric") {
    // Two different points, neither a point of the axis.
    const Json* a = field(item, "a");
    const Json* b = field(item, "b");
    const Json* axis = target(field(item, "axis"));
    return *a != *b && axis != nullptr && !definesCurve(a, *axis) && !definesCurve(b, *axis);
  }
  if (kind == "pointOnCurve" || kind == "midpoint") {
    return !definesCurve(refs[0], *refTargets[1]);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Typed objects from checked JSON

SketchEntityId entityId(const Json& v) { return SketchEntityId(v.get<std::string>()); }

std::vector<SketchEntityId> entityIds(const Json& v) {
  std::vector<SketchEntityId> out;
  for (const auto& id : v) out.push_back(entityId(id));
  return out;
}

std::vector<double> numbers(const Json& v) {
  std::vector<double> out;
  for (const auto& x : v) out.push_back(numberOf(x));
  return out;
}

std::vector<Vec2> vec2s(const Json& v) {
  std::vector<Vec2> out;
  for (const auto& p : v) out.push_back(*core::readVec2(p));
  return out;
}

bool constructionOf(const Json& item) { return item.contains("construction"); }

PatternDirection directionOf(const Json& d) {
  return {numberOf(d.at("angle")), static_cast<int>(numberOf(d.at("count"))),
          numberOf(d.at("spacing"))};
}

TextFont fontOf(const std::string& font) {
  if (font == "serif") return TextFont::Serif;
  if (font == "mono") return TextFont::Mono;
  return TextFont::Sans;
}

EntityPtr readEntity(const Json& item) {
  const std::string kind = item.at("kind").get<std::string>();
  SketchEntityId id = entityId(item.at("id"));
  if (kind == "point") {
    return std::make_shared<SketchPoint>(std::move(id), numberOf(item.at("x")),
                                         numberOf(item.at("y")));
  }
  if (kind == "line") {
    return std::make_shared<SketchLine>(std::move(id), entityId(item.at("p1")),
                                        entityId(item.at("p2")), constructionOf(item));
  }
  if (kind == "circle") {
    return std::make_shared<SketchCircle>(std::move(id), entityId(item.at("center")),
                                          numberOf(item.at("radius")), constructionOf(item));
  }
  if (kind == "arc") {
    return std::make_shared<SketchArc>(std::move(id), entityId(item.at("center")),
                                       entityId(item.at("start")), entityId(item.at("end")),
                                       constructionOf(item));
  }
  if (kind == "bspline") {
    return std::make_shared<SketchBSpline>(
        std::move(id), static_cast<int>(numberOf(item.at("degree"))), entityIds(item.at("poles")),
        numbers(item.at("knots")), constructionOf(item));
  }
  if (kind == "fitSpline") {
    return std::make_shared<SketchFitSpline>(
        std::move(id), static_cast<int>(numberOf(item.at("degree"))), entityIds(item.at("fit")),
        numbers(item.at("params")), vec2s(item.at("poles")), numbers(item.at("knots")),
        constructionOf(item));
  }
  if (kind == "xline") {
    return std::make_shared<SketchXLine>(std::move(id), entityId(item.at("p1")),
                                         entityId(item.at("p2")));
  }
  if (kind == "mirror") {
    return std::make_shared<SketchMirror>(std::move(id), entityIds(item.at("sources")),
                                          entityId(item.at("axis")));
  }
  if (kind == "linearPattern") {
    std::optional<PatternDirection> direction2;
    if (item.contains("direction2")) direction2 = directionOf(item.at("direction2"));
    return std::make_shared<SketchLinearPattern>(std::move(id), entityIds(item.at("sources")),
                                                 directionOf(item.at("direction1")), direction2);
  }
  if (kind == "circularPattern") {
    return std::make_shared<SketchCircularPattern>(
        std::move(id), entityIds(item.at("sources")), entityId(item.at("center")),
        static_cast<int>(numberOf(item.at("count"))), numberOf(item.at("angle")));
  }
  // text
  std::vector<TextContour> contours;
  for (const auto& c : item.at("contours")) {
    TextContour contour;
    contour.charIndex = static_cast<int>(numberOf(c.at("char")));
    contour.code = static_cast<int>(numberOf(c.at("code")));
    for (const auto& segment : c.at("segments")) contour.segments.push_back(vec2s(segment));
    contours.push_back(std::move(contour));
  }
  return std::make_shared<SketchText>(std::move(id), item.at("text").get<std::string>(),
                                      fontOf(item.at("font").get<std::string>()),
                                      numberOf(item.at("height")), entityId(item.at("baseline")),
                                      std::move(contours), constructionOf(item));
}

std::optional<DimensionPlacement> placementOf(const Json& item) {
  const Json* v = field(item, "placement");
  if (v == nullptr) return std::nullopt;
  DimensionPlacement p;
  const std::string kind = kindOf(v);
  if (kind == "linear") {
    p.kind = DimensionPlacement::Kind::Linear;
    p.offset = numberOf(v->at("offset"));
    p.along = numberOf(v->at("along"));
  } else if (kind == "radial") {
    p.kind = DimensionPlacement::Kind::Radial;
    p.angle = numberOf(v->at("angle"));
    p.distance = numberOf(v->at("distance"));
  } else {
    p.kind = DimensionPlacement::Kind::Angular;
    p.radius = numberOf(v->at("radius"));
    p.t = numberOf(v->at("t"));
  }
  return p;
}

ConstraintKind constraintKindOf(const std::string& kind) {
  static const std::map<std::string, ConstraintKind> kinds = {
      {"coincident", ConstraintKind::Coincident},
      {"horizontal", ConstraintKind::Horizontal},
      {"vertical", ConstraintKind::Vertical},
      {"parallel", ConstraintKind::Parallel},
      {"perpendicular", ConstraintKind::Perpendicular},
      {"equal", ConstraintKind::Equal},
      {"tangent", ConstraintKind::Tangent},
      {"pointOnCurve", ConstraintKind::PointOnCurve},
      {"midpoint", ConstraintKind::Midpoint},
      {"hAlign", ConstraintKind::HAlign},
      {"vAlign", ConstraintKind::VAlign},
      {"symmetric", ConstraintKind::Symmetric},
      {"fix", ConstraintKind::Fix},
      {"distance", ConstraintKind::Distance},
      {"hDistance", ConstraintKind::HDistance},
      {"vDistance", ConstraintKind::VDistance},
      {"pointLineDistance", ConstraintKind::PointLineDistance},
      {"angle", ConstraintKind::Angle},
      {"radius", ConstraintKind::Radius},
      {"diameter", ConstraintKind::Diameter},
      {"offset", ConstraintKind::Offset},
  };
  return kinds.at(kind);
}

ConstraintPtr readConstraint(const Json& item) {
  const ConstraintKind kind = constraintKindOf(item.at("kind").get<std::string>());
  SketchConstraintId id(item.at("id").get<std::string>());
  const auto ref = [&item](const char* name) { return entityId(item.at(name)); };
  switch (kind) {
    case ConstraintKind::Coincident:
    case ConstraintKind::Parallel:
    case ConstraintKind::Perpendicular:
    case ConstraintKind::Equal:
    case ConstraintKind::Tangent:
    case ConstraintKind::HAlign:
    case ConstraintKind::VAlign:
      return std::make_shared<PairConstraint>(kind, std::move(id), ref("a"), ref("b"));
    case ConstraintKind::Horizontal:
    case ConstraintKind::Vertical:
      return std::make_shared<LineConstraint>(kind, std::move(id), ref("line"));
    case ConstraintKind::PointOnCurve:
      return std::make_shared<PointOnCurveConstraint>(std::move(id), ref("point"), ref("curve"));
    case ConstraintKind::Midpoint:
      return std::make_shared<MidpointConstraint>(std::move(id), ref("point"), ref("line"));
    case ConstraintKind::Symmetric:
      return std::make_shared<SymmetricConstraint>(std::move(id), ref("a"), ref("b"),
                                                   ref("axis"));
    case ConstraintKind::Fix:
      return std::make_shared<FixConstraint>(std::move(id), ref("point"));
    case ConstraintKind::Distance:
    case ConstraintKind::HDistance:
    case ConstraintKind::VDistance:
      return std::make_shared<DistanceConstraint>(kind, std::move(id), ref("a"), ref("b"),
                                                  numberOf(item.at("value")), placementOf(item));
    case ConstraintKind::PointLineDistance:
      return std::make_shared<PointLineDistanceConstraint>(
          std::move(id), ref("point"), ref("line"), numberOf(item.at("value")),
          placementOf(item));
    case ConstraintKind::Angle:
      return std::make_shared<AngleConstraint>(std::move(id), ref("a"), ref("b"),
                                               numberOf(item.at("value")),
                                               item.contains("reverseA"),
                                               item.contains("reverseB"), placementOf(item));
    case ConstraintKind::Radius:
    case ConstraintKind::Diameter:
      return std::make_shared<RadialConstraint>(kind, std::move(id), ref("curve"),
                                                numberOf(item.at("value")), placementOf(item));
    case ConstraintKind::Offset:
      break;
  }
  std::vector<OffsetPair> pairs;
  for (const auto& p : item.at("pairs")) {
    pairs.push_back({entityId(p.at("source")), entityId(p.at("copy"))});
  }
  return std::make_shared<OffsetConstraint>(std::move(id), std::move(pairs),
                                            numberOf(item.at("value")), placementOf(item));
}

}  // namespace

core::Result<Sketch, std::vector<SketchIssue>> Sketch::parse(const Json& entities,
                                                             const Json& constraints) {
  std::vector<SketchIssue> issues;
  const Json* entityItems = entities.is_array() ? &entities : nullptr;
  const Json* constraintItems = constraints.is_array() ? &constraints : nullptr;
  if (entityItems == nullptr) issues.push_back({SketchIssue::Path::Entities, -1});

  // References may point to later entities, so the checker collects the targets first.
  SketchChecker checker(entityItems);
  if (entityItems != nullptr) {
    for (std::size_t i = 0; i < entityItems->size(); ++i) {
      if (!checker.entityValid((*entityItems)[i])) {
        issues.push_back({SketchIssue::Path::Entities, static_cast<int>(i)});
      }
    }
  }
  if (constraintItems == nullptr) issues.push_back({SketchIssue::Path::Constraints, -1});
  if (constraintItems != nullptr) {
    for (std::size_t i = 0; i < constraintItems->size(); ++i) {
      if (!checker.constraintValid((*constraintItems)[i])) {
        issues.push_back({SketchIssue::Path::Constraints, static_cast<int>(i)});
      }
    }
  }
  if (!issues.empty()) return core::fail(std::move(issues));

  std::vector<EntityPtr> typedEntities;
  for (const auto& item : *entityItems) typedEntities.push_back(readEntity(item));
  std::vector<ConstraintPtr> typedConstraints;
  for (const auto& item : *constraintItems) typedConstraints.push_back(readConstraint(item));
  return Sketch(std::move(typedEntities), std::move(typedConstraints));
}

}  // namespace tinycad::sketch
