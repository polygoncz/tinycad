#include "read_back.hpp"

#include <algorithm>
#include <cmath>
#include <memory>

namespace tinycad::solver_planegcs {

using namespace sketch;

std::optional<std::vector<EntityPtr>> readEntities(GcsWrapper& w,
                                                   const std::vector<EntityPtr>& input) {
  std::vector<EntityPtr> out;
  for (const auto& e : input) {
    switch (e->kind()) {
      case EntityKind::Point: {
        const core::Vec2 p = w.point(e->id().str());
        if (!std::isfinite(p[0]) || !std::isfinite(p[1])) return std::nullopt;
        out.push_back(std::make_shared<SketchPoint>(e->id(), p[0], p[1]));
        break;
      }
      case EntityKind::FitSpline: {
        const auto& f = e->as<SketchFitSpline>();
        std::vector<core::Vec2> poles;
        for (std::size_t i = 0; i < f.poles.size(); ++i) poles.push_back(w.point(poleId(f.id(), i)));
        for (const auto& p : poles) {
          if (!std::isfinite(p[0]) || !std::isfinite(p[1])) return std::nullopt;
        }
        out.push_back(std::make_shared<SketchFitSpline>(f.id(), f.degree, f.fit, f.params,
                                                        std::move(poles), f.knots,
                                                        f.construction));
        break;
      }
      case EntityKind::Circle: {
        const auto& c = e->as<SketchCircle>();
        const double radius = w.circleRadius(c.id().str());
        if (!std::isfinite(radius)) return std::nullopt;
        out.push_back(std::make_shared<SketchCircle>(c.id(), c.center, radius, c.construction));
        break;
      }
      default:
        out.push_back(e);
    }
  }
  return out;
}

std::vector<SketchConstraintId> backToIds(
    const std::vector<std::optional<std::string>>& ids,
    const std::unordered_map<std::string, SketchConstraintId>& constraintIds) {
  std::vector<SketchConstraintId> out;
  for (const auto& id : ids) {
    if (!id) continue;
    const auto it = constraintIds.find(*id);
    if (it == constraintIds.end()) continue;
    if (std::find(out.begin(), out.end(), it->second) == out.end()) out.push_back(it->second);
  }
  return out;
}

Ends passedEnds(GcsWrapper& w, const std::vector<FreeParam>& params) {
  Ends out;
  for (const auto& p : params) {
    const auto t = w.sketchParamValue(p.name);
    if (!t) continue;
    if (*t < 0) {
      out[p.constraint] = 0;
    } else if (*t > 1) {
      out[p.constraint] = 1;
    }
  }
  return out;
}

}  // namespace tinycad::solver_planegcs
