// Regeneration state (spec 07 "Princip", src/regen/state.ts): artifacts, RegenState and the
// statuses of features.

#include "tinycad/regen/state.hpp"

#include "tinycad/core/result.hpp"
#include "tinycad/document/origin.hpp"
#include "tinycad/regen/names.hpp"

namespace tinycad::regen {

// =============================================================================================
// Artifacts

Body::Body(BodyId id, FeatureId origin, FeatureId lastModifiedBy, ShapeHandle shape,
           NameTablePtr names)
    : Artifact(ArtifactKind::Body, id.str()),
      origin_(std::move(origin)),
      lastModifiedBy_(std::move(lastModifiedBy)),
      shape_(shape),
      names_(std::move(names)) {
  TINYCAD_ASSERT(names_ != nullptr, "Body '" + this->id() + "' without a name table");
}

SketchArtifact::SketchArtifact(FeatureId owner)
    : Artifact(ArtifactKind::Sketch, document::sketchId(owner).str()),
      entities(std::make_shared<const core::Json>(core::Json::array())),
      derivedEntities(std::make_shared<const core::Json>(core::Json::array())),
      owner_(std::move(owner)) {}

std::optional<ShapeHandle> SketchArtifact::regionFace(std::string_view name) const {
  for (const auto& region : regions) {
    if (region.name == name) return region.face;
  }
  return std::nullopt;
}

PlaneArtifact::PlaneArtifact(document::PlaneId id, FeatureId owner, Plane plane)
    : Artifact(ArtifactKind::Plane, id.str()), owner_(std::move(owner)), plane_(plane) {}

AxisArtifact::AxisArtifact(document::AxisId id, FeatureId owner, Vec3 origin, Vec3 direction)
    : Artifact(ArtifactKind::Axis, id.str()),
      owner_(std::move(owner)),
      origin_(origin),
      direction_(direction) {}

// =============================================================================================
// RegenState

namespace {

/** The origin planes (xy, xz, yz) and behind them the origin axes (x, y, z) of the owner ORIGIN. */
StatePtr makeEmptyState() {
  const FeatureId origin{std::string(document::ORIGIN)};
  std::vector<ArtifactPtr> artifacts;
  for (const auto& p : document::ORIGIN_PLANES) {
    artifacts.push_back(std::make_shared<const PlaneArtifact>(document::PlaneId(std::string(p.id)),
                                                              origin, p.plane));
  }
  for (const auto& a : document::ORIGIN_AXES) {
    artifacts.push_back(std::make_shared<const AxisArtifact>(document::AxisId(std::string(a.id)),
                                                             origin, a.origin, a.direction));
  }
  return std::make_shared<const RegenState>(std::move(artifacts));
}

/** The artifacts of one kind, cast to their class (the kind was checked). */
template <class T>
std::vector<std::shared_ptr<const T>> ofKind(const std::vector<ArtifactPtr>& artifacts,
                                             ArtifactKind kind) {
  std::vector<std::shared_ptr<const T>> out;
  for (const auto& a : artifacts) {
    // static_pointer_cast is safe: kind() tells the concrete class.
    if (a->kind() == kind) out.push_back(std::static_pointer_cast<const T>(a));
  }
  return out;
}

}  // namespace

const StatePtr& RegenState::empty() {
  static const StatePtr state = makeEmptyState();
  return state;
}

RegenState::RegenState(std::vector<ArtifactPtr> artifacts) : artifacts_(std::move(artifacts)) {
  for (std::size_t i = 0; i < artifacts_.size(); ++i) {
    TINYCAD_ASSERT(artifacts_[i] != nullptr, "RegenState: a null artifact");
    for (std::size_t j = 0; j < i; ++j) {
      TINYCAD_ASSERT(artifacts_[j]->id() != artifacts_[i]->id(),
                     "RegenState: duplicate artifact id '" + artifacts_[i]->id() + "'");
    }
  }
}

ArtifactPtr RegenState::find(std::string_view id) const {
  for (const auto& a : artifacts_) {
    if (a->id() == id) return a;
  }
  return nullptr;
}

std::vector<BodyPtr> RegenState::bodies() const {
  return ofKind<Body>(artifacts_, ArtifactKind::Body);
}

std::vector<SketchArtifactPtr> RegenState::sketches() const {
  return ofKind<SketchArtifact>(artifacts_, ArtifactKind::Sketch);
}

std::vector<std::shared_ptr<const PlaneArtifact>> RegenState::planes() const {
  return ofKind<PlaneArtifact>(artifacts_, ArtifactKind::Plane);
}

std::vector<std::shared_ptr<const AxisArtifact>> RegenState::axes() const {
  return ofKind<AxisArtifact>(artifacts_, ArtifactKind::Axis);
}

StatePtr RegenState::with(ArtifactPtr artifact) const {
  TINYCAD_ASSERT(artifact != nullptr, "RegenState::with: a null artifact");
  std::vector<ArtifactPtr> next = artifacts_;
  bool replaced = false;
  for (auto& a : next) {
    if (a->id() == artifact->id()) {
      a = artifact;
      replaced = true;
      break;
    }
  }
  if (!replaced) next.push_back(std::move(artifact));
  return std::make_shared<const RegenState>(std::move(next));
}

StatePtr RegenState::replaceBodies(const std::map<BodyId, BodyPtr>& changed,
                                   const std::set<BodyId>& consumed) const {
  std::vector<ArtifactPtr> next;
  next.reserve(artifacts_.size());
  for (const auto& a : artifacts_) {
    if (a->kind() != ArtifactKind::Body) {
      next.push_back(a);
      continue;
    }
    const BodyId id(a->id());
    if (consumed.contains(id)) continue;
    const auto it = changed.find(id);
    next.push_back(it == changed.end() ? a : ArtifactPtr(it->second));
  }
  return std::make_shared<const RegenState>(std::move(next));
}

// =============================================================================================
// Feature errors and statuses

std::string_view featureErrorCodeName(FeatureErrorCode code) {
  switch (code) {
    case FeatureErrorCode::InvalidParams:
      return "INVALID_PARAMS";
    case FeatureErrorCode::UnresolvedReference:
      return "UNRESOLVED_REFERENCE";
    case FeatureErrorCode::Kernel:
      return "KERNEL";
    case FeatureErrorCode::UnknownType:
      return "UNKNOWN_TYPE";
    case FeatureErrorCode::StaleVersion:
      return "STALE_VERSION";
  }
  return "KERNEL";
}

std::string_view featureStatusKindName(FeatureStatusKind kind) {
  switch (kind) {
    case FeatureStatusKind::Ok:
      return "ok";
    case FeatureStatusKind::Warning:
      return "warning";
    case FeatureStatusKind::Error:
      return "error";
    case FeatureStatusKind::Suppressed:
      return "suppressed";
    case FeatureStatusKind::RolledBack:
      return "rolledBack";
  }
  return "error";
}

FeatureStatus FeatureStatus::ok() { return {}; }

FeatureStatus FeatureStatus::warning(std::string message) {
  FeatureStatus s;
  s.kind = FeatureStatusKind::Warning;
  s.message = std::move(message);
  return s;
}

FeatureStatus FeatureStatus::failed(FeatureError error) {
  FeatureStatus s;
  s.kind = FeatureStatusKind::Error;
  s.error = std::move(error);
  return s;
}

FeatureStatus FeatureStatus::suppressed() {
  FeatureStatus s;
  s.kind = FeatureStatusKind::Suppressed;
  return s;
}

FeatureStatus FeatureStatus::rolledBack() {
  FeatureStatus s;
  s.kind = FeatureStatusKind::RolledBack;
  return s;
}

}  // namespace tinycad::regen
