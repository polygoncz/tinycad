// The letter curves of sketch texts (spec 12 "Text ve skice (M37)"): port of textCurves and
// derivedOwner of src/sketch/text.ts. The outlines are stored in the local coordinates of the
// text; here they are placed along the baseline without any font.

#include <cmath>
#include <map>
#include <optional>
#include <regex>
#include <string>

#include "derived.hpp"

namespace tinycad::sketch {

namespace {

/**
 * The map from the local coordinates of a text to the sketch: P = p1 + x·û + y·(−û.y, û.x), û the
 * unit direction p1 → p2 of the baseline.
 */
struct TextPlacement {
  double x0 = 0, y0 = 0, ux = 0, uy = 0;

  [[nodiscard]] Vec2 map(const Vec2& p) const {
    return {x0 + p[0] * ux - p[1] * uy, y0 + p[0] * uy + p[1] * ux};
  }
};

/** The placement of a text, or nullopt for a zero-length or missing baseline. */
std::optional<TextPlacement> placementOf(const SketchText& text,
                                         const std::vector<EntityPtr>& entities,
                                         const detail::PointMap& points) {
  const SketchEntity* baseline = nullptr;
  for (const auto& e : entities) {
    if (e->id() == text.baseline) {
      baseline = e.get();
      break;
    }
  }
  if (baseline == nullptr || !baseline->isLineCarrier()) return std::nullopt;
  const auto ends = detail::curvePoints(*baseline);
  const auto p1 = points.find(ends[0]);
  const auto p2 = points.find(ends[1]);
  if (p1 == points.end() || p2 == points.end()) return std::nullopt;
  const double dx = p2->second->x - p1->second->x;
  const double dy = p2->second->y - p1->second->y;
  const double length = std::hypot(dx, dy);
  // No direction to lay the text along: no curves rather than NaN coordinates (like a mirror).
  if (length == 0) return std::nullopt;
  return TextPlacement{p1->second->x, p1->second->y, dx / length, dy / length};
}

/** A segment of 2 poles → a line, 3 or 4 → a Bézier curve as a clamped B-spline. */
Curve2 segmentCurve(std::vector<Vec2> poles, std::string id) {
  if (poles.size() == 2) return Curve2::line(poles[0], poles[1], std::move(id));
  const int degree = static_cast<int>(poles.size()) - 1;
  std::vector<double> knots(static_cast<std::size_t>(degree + 1), 0.0);
  knots.insert(knots.end(), static_cast<std::size_t>(degree + 1), 1.0);
  return Curve2::bspline(degree, std::move(poles), std::move(knots), std::move(id));
}

/** The text of a letter curve id '<text>:<char>-<code>.<loop>.<segment>', else nullopt. */
std::optional<SketchEntityId> letterOwner(std::string_view id) {
  static const std::regex letterSuffix(R"(^\d+-\d+\.\d+\.\d+$)");
  const std::size_t colon = id.find(':');
  if (colon == std::string_view::npos || colon == 0) return std::nullopt;
  const std::string owner(id.substr(0, colon));
  const std::string suffix(id.substr(colon + 1));
  if (owner.find(',') != std::string::npos || !std::regex_match(suffix, letterSuffix)) {
    return std::nullopt;
  }
  return SketchEntityId(owner);
}

}  // namespace

namespace detail {

std::vector<Curve2> textCurvesOf(const std::vector<EntityPtr>& entities) {
  const PointMap points = pointsById(entities);
  std::vector<Curve2> curves;
  for (const auto& e : entities) {
    if (e->kind() != EntityKind::Text) continue;
    const auto& text = e->as<SketchText>();
    const auto place = placementOf(text, entities, points);
    if (!place) continue;
    std::map<int, int> loops;
    for (const auto& contour : text.contours) {
      const int loop = loops[contour.charIndex]++;
      for (std::size_t index = 0; index < contour.segments.size(); ++index) {
        std::vector<Vec2> poles;
        for (const auto& p : contour.segments[index]) poles.push_back(place->map(p));
        std::string id = text.id().str() + ":" + std::to_string(contour.charIndex) + "-" +
                         std::to_string(contour.code) + "." + std::to_string(loop) + "." +
                         std::to_string(index);
        curves.push_back(segmentCurve(std::move(poles), std::move(id)));
      }
    }
  }
  return curves;
}

}  // namespace detail

std::vector<Curve2> Sketch::textCurves() const { return detail::textCurvesOf(entities_); }

std::optional<SketchEntityId> derivedOwner(std::string_view id) {
  // The letter grammar also matches the copy grammar ('<i>-<j>.<source>'), so it goes first; a
  // real copy never matches it, its source is a base62 id without a dot (Q002).
  if (auto owner = letterOwner(id)) return owner;
  return patternOfCopy(id);
}

}  // namespace tinycad::sketch
