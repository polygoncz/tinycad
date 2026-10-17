// BuildContext of one feature build (spec 07 "Builder featury", src/regen/build-context.ts).

#include <utility>

#include "resolve.hpp"
#include "tinycad/regen/builder.hpp"
#include "vec.hpp"

namespace tinycad::regen {

namespace {

/** EPSILON of src/core: a sketch line not longer than this is no axis. */
constexpr double kEpsilon = 1e-9;

/** A point of the sketch plane in world coordinates: origin + x·xDir + y·(normal × xDir). */
Vec3 toWorld(const Plane& plane, const Vec2& p) {
  const Vec3 yDir = vec::cross(plane.normal, plane.xDir);
  return vec::add(plane.origin, vec::add(vec::scale(plane.xDir, p[0]), vec::scale(yDir, p[1])));
}

/** Whether the solved entities of the sketch hold an entity with the id (of any kind). */
bool hasEntity(const SketchArtifact& sketch, const std::string& id) {
  if (sketch.entities == nullptr || !sketch.entities->is_array()) return false;
  for (const auto& entity : *sketch.entities) {
    if (entity.is_object() && entity.contains("id") && entity["id"] == id) return true;
  }
  return false;
}

}  // namespace

BuildContext::BuildContext(kernel::ModelingKernel& kernel, OwnedHandles& owned, StatePtr state)
    : tracking_(kernel, owned), state_(std::move(state)) {}

kernel::ModelingKernel& BuildContext::kernel() { return tracking_; }

const StatePtr& BuildContext::state() const { return state_; }

core::Result<std::vector<BodyPtr>, RefError> BuildContext::resolveBodies(
    const std::vector<EntityRef>& refs) {
  std::vector<BodyPtr> bodies;
  for (const auto& ref : refs) {
    const ArtifactPtr artifact = state_->find(ref.body.str());
    if (artifact == nullptr) {
      return core::fail(RefError{ref, "Body '" + ref.body.str() + "' does not exist"});
    }
    if (artifact->kind() != ArtifactKind::Body) {
      return core::fail(RefError{ref, "'" + ref.body.str() + "' is not a body"});
    }
    // static_pointer_cast is safe: the kind is Body.
    bodies.push_back(std::static_pointer_cast<const Body>(artifact));
  }
  return bodies;
}

core::Result<std::vector<ResolvedPlane>, RefError> BuildContext::resolvePlanes(
    const std::vector<EntityRef>& refs) {
  std::vector<ResolvedPlane> planes;
  for (const auto& ref : refs) {
    auto resolved = detail::resolvePlaneRef(*state_, ref);
    if (!resolved) return core::fail(RefError{ref, resolved.error()});
    // Spec 08: a face name on several faces warns; a sketch plane uses only the first (R96).
    if (ref.kind == document::RefKind::Topo && resolved->matches > 1) {
      warn("Reference '" + ref.name.str() + "' matches " + std::to_string(resolved->matches) +
           " faces; the first is used");
    }
    planes.push_back(ResolvedPlane{ref, resolved->plane});
  }
  return planes;
}

core::Result<std::vector<ResolvedRegion>, RefError> BuildContext::resolveRegions(
    const std::vector<EntityRef>& refs) {
  std::vector<ResolvedRegion> regions;
  for (const auto& ref : refs) {
    const ArtifactPtr artifact = state_->find(document::sketchId(ref.sketch).str());
    if (artifact == nullptr || artifact->kind() != ArtifactKind::Sketch) {
      return core::fail(RefError{ref, "Sketch '" + ref.sketch.str() + "' not found"});
    }
    // static_pointer_cast is safe: the kind is Sketch.
    auto sketch = std::static_pointer_cast<const SketchArtifact>(artifact);
    const auto face = sketch->regionFace(ref.region);
    if (!face) {
      return core::fail(RefError{
          ref, "Region '" + ref.region + "' of sketch '" + ref.sketch.str() + "' not found"});
    }
    regions.push_back(ResolvedRegion{ref, std::move(sketch), *face});
  }
  return regions;
}

core::Result<ResolvedAxis, RefError> BuildContext::resolveAxis(const EntityRef& ref) {
  if (ref.kind == document::RefKind::Axis) {
    const ArtifactPtr artifact = state_->find(ref.axis.str());
    if (artifact == nullptr) {
      return core::fail(RefError{ref, "Axis '" + ref.axis.str() + "' does not exist"});
    }
    if (artifact->kind() != ArtifactKind::Axis) {
      return core::fail(RefError{ref, "'" + ref.axis.str() + "' is not an axis"});
    }
    const auto& axis = artifact->as<AxisArtifact>();
    return ResolvedAxis{axis.origin(), axis.direction()};
  }
  if (ref.kind != document::RefKind::SketchEntity) {
    return core::fail(RefError{ref, "Not an axis reference"});
  }
  const ArtifactPtr artifact = state_->find(document::sketchId(ref.sketch).str());
  if (artifact == nullptr || artifact->kind() != ArtifactKind::Sketch) {
    return core::fail(RefError{ref, "Sketch '" + ref.sketch.str() + "' not found"});
  }
  const auto& sketch = artifact->as<SketchArtifact>();
  const SketchLineSegment* line = nullptr;
  for (const auto& l : sketch.lines) {
    if (l.id == ref.entity) {
      line = &l;
      break;
    }
  }
  if (line == nullptr) {
    if (hasEntity(sketch, ref.entity)) {
      return core::fail(RefError{ref, "Sketch entity '" + ref.entity + "' is not a line"});
    }
    return core::fail(RefError{ref, "Sketch entity '" + ref.entity + "' of sketch '" +
                                        ref.sketch.str() + "' not found"});
  }
  const Vec3 p1 = toWorld(sketch.plane, line->p1);
  const Vec3 p2 = toWorld(sketch.plane, line->p2);
  const Vec3 d = vec::sub(p2, p1);
  if (vec::length(d) <= kEpsilon) {
    return core::fail(RefError{ref, "Sketch line '" + ref.entity + "' has zero length"});
  }
  return ResolvedAxis{p1, vec::normalize(d)};
}

core::Result<std::vector<ResolvedTopo>, RefError> BuildContext::resolveTopo(
    const std::vector<EntityRef>& refs, TopoKind kind) {
  std::vector<ResolvedTopo> resolved;
  for (const auto& ref : refs) {
    auto found = detail::resolveNamed(*state_, ref.body, ref.name, kind);
    if (!found) return core::fail(RefError{ref, found.error()});
    // Several edges under one name are usually wanted (spec 08): no warning for them.
    if (kind == TopoKind::Face && found->indices.size() > 1) {
      warn("Reference '" + ref.name.str() + "' matches " + std::to_string(found->indices.size()) +
           " faces; all are used");
    }
    resolved.push_back(ResolvedTopo{ref, std::move(found->body), std::move(found->indices)});
  }
  return resolved;
}

void BuildContext::warn(std::string message) { messages_.push_back(std::move(message)); }

std::optional<std::string> BuildContext::warnings() const {
  if (messages_.empty()) return std::nullopt;
  std::string joined;
  for (std::size_t i = 0; i < messages_.size(); ++i) {
    if (i > 0) joined += '\n';
    joined += messages_[i];
  }
  return joined;
}

}  // namespace tinycad::regen
