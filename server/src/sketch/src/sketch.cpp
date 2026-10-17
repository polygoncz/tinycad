// The parsed sketch: its parts and the lookup by id.

#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch {

Sketch::Sketch(std::vector<EntityPtr> entities, std::vector<ConstraintPtr> constraints)
    : entities_(std::move(entities)), constraints_(std::move(constraints)) {
  // The first entity with an id wins (parse guarantees unique ids anyway).
  for (const auto& e : entities_) byId_.emplace(e->id(), e);
}

const SketchEntity* Sketch::findEntity(const SketchEntityId& id) const {
  const auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : it->second.get();
}

const SketchPoint* Sketch::findPoint(const SketchEntityId& id) const {
  const SketchEntity* e = findEntity(id);
  return e != nullptr && e->kind() == EntityKind::Point ? &e->as<SketchPoint>() : nullptr;
}

}  // namespace tinycad::sketch
