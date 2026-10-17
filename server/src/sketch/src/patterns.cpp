// Copies of mirrors and patterns (spec 12 "Zrcadlení a pole (M36)"): port of src/sketch/patterns.ts.
// A pattern is a recipe; its copies are derived here from the solved originals and never enter
// the solver. A copy has the derived id '<pattern>:<index>.<source>'.

#include <cmath>
#include <regex>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include "derived.hpp"

namespace tinycad::sketch {

namespace {

/** One instance of a pattern other than the original: its index and how it moves a point. */
struct Instance {
  enum class Kind { Reflect, Translate, Rotate };
  Kind kind = Kind::Translate;
  std::string index;
  /** Reflect: a point o of the axis and its unit direction d. */
  Vec2 o{}, d{};
  /** Translate: i steps of direction 1 and j of direction 2. */
  double i = 0, j = 0;
  Vec2 step1{}, step2{};
  /** Rotate: the centre and the cos / sin of the angle. */
  double cx = 0, cy = 0, cos = 1, sin = 0;

  /** A reflection: arcs swap start and end to stay counter-clockwise. */
  [[nodiscard]] bool mirrored() const { return kind == Kind::Reflect; }

  [[nodiscard]] Vec2 map(const Vec2& p) const {
    switch (kind) {
      case Kind::Reflect: {
        // p' = o + 2·((p − o)·d)·d − (p − o)
        const double vx = p[0] - o[0];
        const double vy = p[1] - o[1];
        const double along = vx * d[0] + vy * d[1];
        return {o[0] + 2 * along * d[0] - vx, o[1] + 2 * along * d[1] - vy};
      }
      case Kind::Translate:
        return {p[0] + i * step1[0] + j * step2[0], p[1] + i * step1[1] + j * step2[1]};
      case Kind::Rotate: {
        const double vx = p[0] - cx;
        const double vy = p[1] - cy;
        return {cx + cos * vx - sin * vy, cy + sin * vx + cos * vy};
      }
    }
    return p;
  }
};

using EntityMap = std::unordered_map<SketchEntityId, const SketchEntity*>;

std::vector<Instance> mirrorInstances(const SketchMirror& pattern, const EntityMap& entities,
                                      const detail::PointMap& points) {
  const auto line = entities.find(pattern.axis);
  if (line == entities.end() || !line->second->isLineCarrier()) return {};
  const auto ends = detail::curvePoints(*line->second);
  const auto p1 = points.find(ends[0]);
  const auto p2 = points.find(ends[1]);
  if (p1 == points.end() || p2 == points.end()) return {};
  const Vec2 o = {p1->second->x, p1->second->y};
  const double dx = p2->second->x - o[0];
  const double dy = p2->second->y - o[1];
  const double length = std::hypot(dx, dy);
  // A zero-length axis defines no line to mirror across: no copy rather than NaN coordinates.
  if (length == 0) return {};
  Instance instance;
  instance.kind = Instance::Kind::Reflect;
  instance.index = "1";
  instance.o = o;
  instance.d = {dx / length, dy / length};
  return {instance};
}

Instance translation(std::string index, int i, int j, const Vec2& step1, const Vec2& step2) {
  Instance instance;
  instance.kind = Instance::Kind::Translate;
  instance.index = std::move(index);
  instance.i = i;
  instance.j = j;
  instance.step1 = step1;
  instance.step2 = step2;
  return instance;
}

std::vector<Instance> linearInstances(const SketchLinearPattern& pattern) {
  const PatternDirection& d1 = pattern.direction1;
  const Vec2 step1 = {d1.spacing * std::cos(d1.angle), d1.spacing * std::sin(d1.angle)};
  std::vector<Instance> out;
  if (!pattern.direction2) {
    for (int i = 1; i < d1.count; ++i) {
      out.push_back(translation(std::to_string(i), i, 0, step1, {0, 0}));
    }
    return out;
  }
  const PatternDirection& d2 = *pattern.direction2;
  const Vec2 step2 = {d2.spacing * std::cos(d2.angle), d2.spacing * std::sin(d2.angle)};
  for (int i = 0; i < d1.count; ++i) {
    for (int j = 0; j < d2.count; ++j) {
      if (i == 0 && j == 0) continue;
      out.push_back(
          translation(std::to_string(i) + "-" + std::to_string(j), i, j, step1, step2));
    }
  }
  return out;
}

std::vector<Instance> circularInstances(const SketchCircularPattern& pattern,
                                        const detail::PointMap& points) {
  const auto center = points.find(pattern.center);
  if (center == points.end()) return {};
  const double step = pattern.step();
  std::vector<Instance> out;
  for (int k = 1; k < pattern.count; ++k) {
    Instance instance;
    instance.kind = Instance::Kind::Rotate;
    instance.index = std::to_string(k);
    instance.cx = center->second->x;
    instance.cy = center->second->y;
    instance.cos = std::cos(k * step);
    instance.sin = std::sin(k * step);
    out.push_back(instance);
  }
  return out;
}

/** The instances of a pattern without the original, in ascending index order. */
std::vector<Instance> instancesOf(const SketchEntity& pattern, const EntityMap& entities,
                                  const detail::PointMap& points) {
  switch (pattern.kind()) {
    case EntityKind::Mirror:
      return mirrorInstances(pattern.as<SketchMirror>(), entities, points);
    case EntityKind::LinearPattern:
      return linearInstances(pattern.as<SketchLinearPattern>());
    case EntityKind::CircularPattern:
      return circularInstances(pattern.as<SketchCircularPattern>(), points);
    default:
      return {};
  }
}

const std::vector<SketchEntityId>& sourcesOf(const SketchEntity& pattern) {
  switch (pattern.kind()) {
    case EntityKind::Mirror:
      return pattern.as<SketchMirror>().sources;
    case EntityKind::LinearPattern:
      return pattern.as<SketchLinearPattern>().sources;
    default:
      break;
  }
  return pattern.as<SketchCircularPattern>().sources;
}

/** Makes the copies of one instance of one pattern. */
class InstanceCopier {
 public:
  InstanceCopier(const SketchEntityId& pattern, const Instance& instance,
                 const detail::PointMap& points, std::vector<EntityPtr>& out)
      : pattern_(pattern), instance_(instance), points_(points), out_(out) {}

  void copySource(const SketchEntity& source) {
    if (source.kind() == EntityKind::Point) {
      copyPoint(source.id());
      return;
    }
    for (const auto& p : detail::curvePoints(source)) copyPoint(p);
    SketchEntityId copyId = derived(source.id());
    if (!done_.insert(copyId).second) return;
    out_.push_back(copyCurve(source, std::move(copyId)));
  }

 private:
  [[nodiscard]] SketchEntityId derived(const SketchEntityId& source) const {
    return SketchEntityId(pattern_.str() + ":" + instance_.index + "." + source.str());
  }

  [[nodiscard]] std::vector<SketchEntityId> derivedAll(
      const std::vector<SketchEntityId>& ids) const {
    std::vector<SketchEntityId> out;
    for (const auto& id : ids) out.push_back(derived(id));
    return out;
  }

  void copyPoint(const SketchEntityId& id) {
    const auto p = points_.find(id);
    SketchEntityId copyId = derived(id);
    if (p == points_.end() || done_.contains(copyId)) return;
    done_.insert(copyId);
    const Vec2 moved = instance_.map({p->second->x, p->second->y});
    out_.push_back(std::make_shared<SketchPoint>(std::move(copyId), moved[0], moved[1]));
  }

  /** The copy of a curve: its points by derived ids, coordinates it stores moved, construction kept. */
  [[nodiscard]] EntityPtr copyCurve(const SketchEntity& c, SketchEntityId id) const {
    switch (c.kind()) {
      case EntityKind::Line: {
        const auto& l = c.as<SketchLine>();
        return std::make_shared<SketchLine>(std::move(id), derived(l.p1), derived(l.p2),
                                            l.construction);
      }
      case EntityKind::Circle: {
        const auto& ci = c.as<SketchCircle>();
        return std::make_shared<SketchCircle>(std::move(id), derived(ci.center), ci.radius,
                                              ci.construction);
      }
      case EntityKind::Arc: {
        const auto& a = c.as<SketchArc>();
        // A reflection turns the arc clockwise; swapping its ends keeps it counter-clockwise.
        const bool swap = instance_.mirrored();
        return std::make_shared<SketchArc>(std::move(id), derived(a.center),
                                           derived(swap ? a.end : a.start),
                                           derived(swap ? a.start : a.end), a.construction);
      }
      case EntityKind::BSpline: {
        const auto& b = c.as<SketchBSpline>();
        return std::make_shared<SketchBSpline>(std::move(id), b.degree, derivedAll(b.poles),
                                               b.knots, b.construction);
      }
      case EntityKind::FitSpline: {
        const auto& f = c.as<SketchFitSpline>();
        std::vector<Vec2> poles;
        for (const auto& p : f.poles) poles.push_back(instance_.map(p));
        return std::make_shared<SketchFitSpline>(std::move(id), f.degree, derivedAll(f.fit),
                                                 f.params, std::move(poles), f.knots,
                                                 f.construction);
      }
      case EntityKind::XLine: {
        // An xline (M31) is always construction; its copy too.
        const auto& x = c.as<SketchXLine>();
        return std::make_shared<SketchXLine>(std::move(id), derived(x.p1), derived(x.p2));
      }
      default:
        break;
    }
    TINYCAD_ASSERT(false, "copyCurve: '" + c.id().str() + "' is not a curve");
    return nullptr;
  }

  const SketchEntityId& pattern_;
  const Instance& instance_;
  const detail::PointMap& points_;
  std::vector<EntityPtr>& out_;
  std::unordered_set<SketchEntityId> done_;
};

}  // namespace

std::vector<EntityPtr> Sketch::patternCopies() const {
  EntityMap entities;
  for (const auto& e : entities_) entities[e->id()] = e.get();
  const detail::PointMap points = detail::pointsById(entities_);
  std::vector<EntityPtr> copies;
  for (const auto& pattern : entities_) {
    if (!pattern->isPattern()) continue;
    for (const auto& instance : instancesOf(*pattern, entities, points)) {
      InstanceCopier copier(pattern->id(), instance, points, copies);
      for (const auto& sourceId : sourcesOf(*pattern)) {
        const auto source = entities.find(sourceId);
        // parse guarantees a point or a curve; anything else has no copy.
        if (source == entities.end() || !source->second->isPatternSource()) continue;
        copier.copySource(*source->second);
      }
    }
  }
  return copies;
}

std::optional<SketchEntityId> patternOfCopy(std::string_view id) {
  static const std::regex copySuffix(R"(^\d+(?:-\d+)?\.[^:,]+$)");
  const std::size_t colon = id.find(':');
  if (colon == std::string_view::npos || colon == 0) return std::nullopt;
  const std::string pattern(id.substr(0, colon));
  const std::string suffix(id.substr(colon + 1));
  if (pattern.find(',') != std::string::npos || !std::regex_match(suffix, copySuffix)) {
    return std::nullopt;
  }
  return SketchEntityId(pattern);
}

}  // namespace tinycad::sketch
