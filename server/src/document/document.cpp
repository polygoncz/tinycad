#include "tinycad/document/document.hpp"

#include <cstddef>
#include <set>
#include <utility>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/origin.hpp"

namespace tinycad::document {

namespace {

// Every mutator checks first and then commits a whole new studio in one step, so a mutator that
// fails its checks leaves the document untouched (the same rule as cad-document.ts).

void assertRollbackIndex(int index, std::size_t length) {
  TINYCAD_ASSERT(index >= 0 && static_cast<std::size_t>(index) <= length,
                 "Rollback index " + std::to_string(index) + " out of range 0.." +
                     std::to_string(length));
}

void assertIndex(int index, std::size_t max) {
  TINYCAD_ASSERT(index >= 0 && static_cast<std::size_t>(index) <= max,
                 "Feature index " + std::to_string(index) + " out of range 0.." +
                     std::to_string(max));
}

bool isFeatureIdText(const FeatureId& id) {
  return !id.empty() && id.str().find('/') == std::string::npos && id.str() != ORIGIN;
}

/**
 * The canonical form of body metadata (spec 03): name only when non-empty, hidden only as true,
 * color only when valid, material only when not the default. Empty when nothing is left.
 */
BodyMeta canonicalMeta(const BodyMeta& meta) {
  BodyMeta out;
  if (meta.name && !meta.name->empty()) out.name = meta.name;
  out.hidden = meta.hidden;
  if (meta.color && isBodyColor(*meta.color)) out.color = meta.color;
  if (meta.material && *meta.material != DEFAULT_BODY_MATERIAL) out.material = meta.material;
  return out;
}

void assertStudio(const PartStudioData& studio) {
  std::set<FeatureId> seen;
  for (const FeaturePtr& f : studio.features) {
    TINYCAD_ASSERT(f != nullptr, "A feature must not be null");
    TINYCAD_ASSERT(isFeatureIdText(f->id), "Invalid feature id '" + f->id.str() + "'");
    TINYCAD_ASSERT(f->params != nullptr, "Feature '" + f->id.str() + "' has no params");
    TINYCAD_ASSERT(seen.insert(f->id).second, "Duplicate feature id '" + f->id.str() + "'");
  }
  assertRollbackIndex(studio.rollbackIndex, studio.features.size());
  for (const auto& [body, meta] : studio.bodies) {
    TINYCAD_ASSERT(parseBodyId(body.str()).has_value(), "Invalid body id '" + body.str() + "'");
    TINYCAD_ASSERT(!meta.empty() && canonicalMeta(meta) == meta,
                   "Body metadata of '" + body.str() + "' is not canonical");
  }
}

}  // namespace

Document::Document(DocumentMeta meta, StudioPtr studio)
    : meta_(std::move(meta)), studio_(std::move(studio)) {
  TINYCAD_ASSERT(studio_ != nullptr, "Document: the studio must not be null");
  assertStudio(*studio_);
}

const DocumentMeta& Document::meta() const { return meta_; }

StudioPtr Document::studio() const { return studio_; }

FeaturePtr Document::feature(const FeatureId& id) const {
  const int index = indexOf(id);
  return index == -1 ? nullptr : studio_->features[static_cast<std::size_t>(index)];
}

// Linear scan: tens to hundreds of features, an id map would only add state to keep in sync.
int Document::indexOf(const FeatureId& id) const {
  const auto& features = studio_->features;
  for (std::size_t i = 0; i < features.size(); ++i) {
    if (features[i]->id == id) return static_cast<int>(i);
  }
  return -1;
}

BodyMeta Document::bodyMeta(const BodyId& body) const {
  const auto it = studio_->bodies.find(body);
  return it == studio_->bodies.end() ? BodyMeta{} : it->second;
}

void Document::insertFeature(int index, FeaturePtr feature) {
  TINYCAD_ASSERT(feature != nullptr, "insertFeature: the feature must not be null");
  const auto& features = studio_->features;
  assertIndex(index, features.size());
  TINYCAD_ASSERT(isFeatureIdText(feature->id), "Invalid feature id '" + feature->id.str() + "'");
  TINYCAD_ASSERT(feature->params != nullptr, "insertFeature: the params must not be null");
  TINYCAD_ASSERT(indexOf(feature->id) == -1, "Duplicate feature id '" + feature->id.str() + "'");
  auto next = std::make_shared<PartStudioData>(*studio_);
  next->features.insert(next->features.begin() + index, std::move(feature));
  // Q029: inserting at the bar makes the new feature active.
  if (index <= studio_->rollbackIndex) next->rollbackIndex = studio_->rollbackIndex + 1;
  studio_ = std::move(next);
}

void Document::removeFeature(const FeatureId& id) {
  const int index = indexOf(id);
  TINYCAD_ASSERT(index != -1, "Unknown feature '" + id.str() + "'");
  auto next = std::make_shared<PartStudioData>(*studio_);
  next->features.erase(next->features.begin() + index);
  if (index < studio_->rollbackIndex) next->rollbackIndex = studio_->rollbackIndex - 1;
  studio_ = std::move(next);
}

void Document::replaceFeature(FeaturePtr feature) {
  TINYCAD_ASSERT(feature != nullptr, "replaceFeature: the feature must not be null");
  const int index = indexOf(feature->id);
  TINYCAD_ASSERT(index != -1, "Unknown feature '" + feature->id.str() + "'");
  TINYCAD_ASSERT(feature->params != nullptr, "replaceFeature: the params must not be null");
  const auto at = static_cast<std::size_t>(index);
  if (studio_->features[at] == feature) return;
  // A copy of the vector of pointers: every other feature stays the same FeaturePtr (N17).
  auto next = std::make_shared<PartStudioData>(*studio_);
  next->features[at] = std::move(feature);
  studio_ = std::move(next);
}

/** `toIndex` is the final index of the feature: remove at `from`, then insert at `toIndex` (Q029). */
void Document::moveFeature(const FeatureId& id, int toIndex) {
  const int from = indexOf(id);
  TINYCAD_ASSERT(from != -1, "Unknown feature '" + id.str() + "'");
  assertIndex(toIndex, studio_->features.size() - 1);
  if (from == toIndex) return;
  const int bar = studio_->rollbackIndex;
  const int afterRemove = from < bar ? bar - 1 : bar;
  const int afterInsert = toIndex <= afterRemove ? afterRemove + 1 : afterRemove;
  auto next = std::make_shared<PartStudioData>(*studio_);
  FeaturePtr moved = next->features[static_cast<std::size_t>(from)];
  next->features.erase(next->features.begin() + from);
  next->features.insert(next->features.begin() + toIndex, std::move(moved));
  next->rollbackIndex = afterInsert;
  studio_ = std::move(next);
}

void Document::setRollbackIndex(int index) {
  assertRollbackIndex(index, studio_->features.size());
  if (index == studio_->rollbackIndex) return;
  auto next = std::make_shared<PartStudioData>(*studio_);
  next->rollbackIndex = index;
  studio_ = std::move(next);
}

void Document::setBodyMeta(const BodyId& body, const BodyMeta& meta) {
  const BodyMeta canonical = canonicalMeta(meta);
  // The stored metadata are canonical already.
  if (bodyMeta(body) == canonical) return;
  // Same features and rollback index: the regeneration cache keyed by features stays valid.
  auto next = std::make_shared<PartStudioData>(*studio_);
  if (canonical.empty()) {
    next->bodies.erase(body);
  } else {
    next->bodies[body] = canonical;
  }
  studio_ = std::move(next);
}

void Document::rename(std::string name) { meta_.name = std::move(name); }

}  // namespace tinycad::document
