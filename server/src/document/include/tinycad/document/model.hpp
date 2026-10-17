#pragma once

// The document model (spec 03 "Model", src/document/model.ts): a recipe, an ordered list of
// features (ADR 0003). Immutable values with structural sharing (decision N17):
//
// - FeatureInstance is shared as FeaturePtr = shared_ptr<const FeatureInstance>. A change makes a
//   new FeatureInstance; the untouched features of the next PartStudioData are the SAME pointers.
//   Pointer identity is what the regeneration cache keys on (spec 07, M43), like object identity
//   in TS.
// - Feature params stay dynamic JSON (decision N18): their shape is given by the feature schema,
//   not by C++ types, exactly like google.protobuf.Struct on the wire (spec 14).
// - A whole PartStudioData is shared as StudioPtr; a document change replaces it, so a reader
//   (regen, storage) holding a StudioPtr keeps a consistent snapshot for free.

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/strong_id.hpp"

namespace tinycad::document {

using Json = core::Json;

struct DocumentIdTag;
struct FeatureIdTag;
struct BodyIdTag;

using DocumentId = core::StrongId<DocumentIdTag>;
/** Non-empty, without '/', other than "origin" (spec 03). */
using FeatureId = core::StrongId<FeatureIdTag>;
/** '<featureId>/body' or '<featureId>/body:<n>', n >= 1; minted only by bodyId() (refs.hpp, ADR 0015). */
using BodyId = core::StrongId<BodyIdTag>;

struct FeatureInstance {
  FeatureId id;
  /** Key into the registries: "box", "cylinder", … */
  std::string type;
  /** Schema version the params were written with; fromData migrates older ones. */
  int typeVersion = 1;
  /** Display name, "Box 1". */
  std::string name;
  /** A plain JSON object (isJsonObject); never null. Unchecked: invalid params are a legal state. */
  std::shared_ptr<const Json> params;
  /** A suppressed feature is skipped by regeneration. */
  bool suppressed = false;
};

using FeaturePtr = std::shared_ptr<const FeatureInstance>;

/** A material preset of a body (spec 03, M24); JSON names in BODY_MATERIAL_NAMES. */
enum class BodyMaterial { Plastic, Aluminium, Steel, Brass, Glass, Rubber };

/** "plastic", "aluminium", "steel", "brass", "glass", "rubber" – UI order. */
inline constexpr std::string_view BODY_MATERIAL_NAMES[] = {"plastic", "aluminium", "steel",
                                                            "brass",   "glass",     "rubber"};

/** Never stored in the canonical form (M24). */
inline constexpr BodyMaterial DEFAULT_BODY_MATERIAL = BodyMaterial::Plastic;

std::string_view bodyMaterialName(BodyMaterial material);
/** Exact lower-case names only (isBodyMaterial). */
std::optional<BodyMaterial> parseBodyMaterial(std::string_view name);
/** '#rrggbb' in lower case (isBodyColor). */
bool isBodyColor(std::string_view color);

/**
 * Name, visibility, color and material of a body (spec 03 "Metadata těles"). Canonical form, kept
 * by the document: name only when non-empty, hidden only as true, color only when isBodyColor,
 * material only when not DEFAULT_BODY_MATERIAL. An empty BodyMeta is never stored.
 */
struct BodyMeta {
  std::optional<std::string> name;
  bool hidden = false;
  std::optional<std::string> color;
  std::optional<BodyMaterial> material;

  [[nodiscard]] bool empty() const noexcept {
    return !name && !hidden && !color && !material;
  }
  friend bool operator==(const BodyMeta&, const BodyMeta&) = default;
};

/** Ordered by BodyId, so JSON output and comparisons are deterministic. */
using BodyMetaMap = std::map<BodyId, BodyMeta>;

struct PartStudioData {
  std::vector<FeaturePtr> features;
  /** 0..features.size(); features[i] is replayed when i < rollbackIndex. */
  int rollbackIndex = 0;
  /** Canonical: no empty entries; empty map = absent in JSON. */
  BodyMetaMap bodies;
};

using StudioPtr = std::shared_ptr<const PartStudioData>;

struct DocumentMeta {
  DocumentId id;
  std::string name;
  /** Unix time in ms; a double like the TS number, so any finite JSON value round-trips. */
  double createdAt = 0;
};

/**
 * Value equality of two features: same fields and equal params JSON (not pointer identity).
 * Replay tests compare documents with it.
 */
bool sameFeature(const FeatureInstance& a, const FeatureInstance& b);

/** Value equality of two studios (features by sameFeature, rollback index, body metadata). */
bool sameStudio(const PartStudioData& a, const PartStudioData& b);

}  // namespace tinycad::document
