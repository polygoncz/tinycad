#include "tinycad/document/refs.hpp"

#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::document {

namespace {

/** The value under `key` of an object, nullptr when absent (or when `object` is no object). */
const Json* field(const Json& object, const char* key) {
  if (!object.is_object()) return nullptr;
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

/** The string under `key`, nullptr when absent or not a string. */
const std::string* stringField(const Json& object, const char* key) {
  const Json* value = field(object, key);
  return value != nullptr && value->is_string() ? value->get_ptr<const std::string*>() : nullptr;
}

bool isNonEmpty(const std::string* text) { return text != nullptr && !text->empty(); }

bool isLowerAlnum(std::string_view text) {
  if (text.empty()) return false;
  for (const char c : text) {
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;
  }
  return true;
}

/**
 * Splits '<owner>/<rest>' at the first '/': the owner must be non-empty; nullopt without '/'.
 * The rest may still contain '/', the callers match it exactly.
 */
std::optional<std::pair<std::string_view, std::string_view>> splitOwner(std::string_view text) {
  const auto slash = text.find('/');
  if (slash == std::string_view::npos || slash == 0) return std::nullopt;
  return std::pair{text.substr(0, slash), text.substr(slash + 1)};
}

/** 'body' or 'body:<n>' with n >= 1 without leading zeros (the regex /body(?::[1-9][0-9]*)?$/). */
bool isBodyRest(std::string_view rest) {
  if (rest == "body") return true;
  constexpr std::string_view prefix = "body:";
  if (!rest.starts_with(prefix)) return false;
  const std::string_view digits = rest.substr(prefix.size());
  if (digits.empty() || digits[0] < '1' || digits[0] > '9') return false;
  for (const char c : digits) {
    if (c < '0' || c > '9') return false;
  }
  return true;
}

/** '<prefix><name>' with the name [a-z0-9]+. */
bool isNamedRest(std::string_view rest, std::string_view prefix) {
  return rest.starts_with(prefix) && isLowerAlnum(rest.substr(prefix.size()));
}

}  // namespace

std::string_view refKindName(RefKind kind) {
  switch (kind) {
    case RefKind::Body: return "body";
    case RefKind::Topo: return "topo";
    case RefKind::Region: return "region";
    case RefKind::Plane: return "plane";
    case RefKind::Axis: return "axis";
    case RefKind::SketchEntity: return "sketchEntity";
  }
  TINYCAD_ASSERT(false, "refKindName: unknown kind");
  return {};
}

EntityRef EntityRef::toBody(BodyId body) {
  EntityRef ref;
  ref.kind = RefKind::Body;
  ref.body = std::move(body);
  return ref;
}

EntityRef EntityRef::toTopo(BodyId body, TopoName name) {
  EntityRef ref;
  ref.kind = RefKind::Topo;
  ref.body = std::move(body);
  ref.name = std::move(name);
  return ref;
}

EntityRef EntityRef::toRegion(FeatureId sketch, std::string region) {
  EntityRef ref;
  ref.kind = RefKind::Region;
  ref.sketch = std::move(sketch);
  ref.region = std::move(region);
  return ref;
}

EntityRef EntityRef::toPlane(PlaneId plane) {
  EntityRef ref;
  ref.kind = RefKind::Plane;
  ref.plane = std::move(plane);
  return ref;
}

EntityRef EntityRef::toAxis(AxisId axis) {
  EntityRef ref;
  ref.kind = RefKind::Axis;
  ref.axis = std::move(axis);
  return ref;
}

EntityRef EntityRef::toSketchEntity(FeatureId sketch, std::string entity) {
  EntityRef ref;
  ref.kind = RefKind::SketchEntity;
  ref.sketch = std::move(sketch);
  ref.entity = std::move(entity);
  return ref;
}

BodyId bodyId(const FeatureId& origin, std::optional<int> n) {
  // The owner is read back up to the first '/', so it must not contain one (spec 03).
  TINYCAD_ASSERT(!origin.empty() && origin.str().find('/') == std::string::npos,
                 "bodyId: invalid origin '" + origin.str() + "'");
  TINYCAD_ASSERT(!n || *n >= 1, "bodyId: n must be a whole number >= 1");
  // The trusted place where a BodyId is minted (ADR 0015).
  return BodyId(origin.str() + "/body" + (n ? ":" + std::to_string(*n) : std::string()));
}

SketchId sketchId(const FeatureId& owner) {
  TINYCAD_ASSERT(!owner.empty() && owner.str().find('/') == std::string::npos,
                 "sketchId: invalid owner '" + owner.str() + "'");
  return SketchId(owner.str() + "/sketch");
}

std::optional<BodyId> parseBodyId(std::string_view text) {
  const auto parts = splitOwner(text);
  if (!parts || !isBodyRest(parts->second)) return std::nullopt;
  return BodyId(std::string(text));
}

std::optional<PlaneId> parsePlaneId(std::string_view text) {
  const auto parts = splitOwner(text);
  if (!parts || !isNamedRest(parts->second, "plane:")) return std::nullopt;
  return PlaneId(std::string(text));
}

std::optional<AxisId> parseAxisId(std::string_view text) {
  const auto parts = splitOwner(text);
  if (!parts || !isNamedRest(parts->second, "axis:")) return std::nullopt;
  return AxisId(std::string(text));
}

std::optional<SketchId> parseSketchId(std::string_view text) {
  const auto parts = splitOwner(text);
  if (!parts || parts->second != "sketch") return std::nullopt;
  return SketchId(std::string(text));
}

FeatureId ownerOfArtifact(std::string_view artifactId) {
  const auto slash = artifactId.find('/');
  TINYCAD_ASSERT(slash != std::string_view::npos,
                 "ownerOfArtifact: '" + std::string(artifactId) + "' is not an artifact id");
  return FeatureId(std::string(artifactId.substr(0, slash)));
}

FeatureId originOfBody(const BodyId& body) { return ownerOfArtifact(body.str()); }

FeatureId ownerOf(const EntityRef& ref) {
  switch (ref.kind) {
    case RefKind::Body:
    case RefKind::Topo: return originOfBody(ref.body);
    case RefKind::Region:
    case RefKind::SketchEntity: return ref.sketch;
    case RefKind::Plane: return ownerOfArtifact(ref.plane.str());
    case RefKind::Axis: return ownerOfArtifact(ref.axis.str());
  }
  TINYCAD_ASSERT(false, "ownerOf: unknown kind");
  return {};
}

std::optional<EntityRef> readRef(RefKind kind, const Json& raw) {
  const std::string* rawKind = stringField(raw, "kind");
  if (rawKind == nullptr || *rawKind != refKindName(kind)) return std::nullopt;
  switch (kind) {
    case RefKind::Body: {
      const std::string* body = stringField(raw, "body");
      const auto id = body ? parseBodyId(*body) : std::nullopt;
      if (!id) return std::nullopt;
      return EntityRef::toBody(*id);
    }
    case RefKind::Topo: {
      const std::string* body = stringField(raw, "body");
      const std::string* name = stringField(raw, "name");
      const auto id = body ? parseBodyId(*body) : std::nullopt;
      // An empty name names nothing (M14); the name itself is minted by regen only.
      if (!id || !isNonEmpty(name)) return std::nullopt;
      return EntityRef::toTopo(*id, TopoName(*name));
    }
    case RefKind::Region: {
      const std::string* sketch = stringField(raw, "sketch");
      const std::string* region = stringField(raw, "region");
      if (sketch == nullptr || region == nullptr) return std::nullopt;
      return EntityRef::toRegion(FeatureId(*sketch), *region);
    }
    case RefKind::Plane: {
      const std::string* plane = stringField(raw, "plane");
      const auto id = plane ? parsePlaneId(*plane) : std::nullopt;
      if (!id) return std::nullopt;
      return EntityRef::toPlane(*id);
    }
    case RefKind::Axis: {
      const std::string* axis = stringField(raw, "axis");
      const auto id = axis ? parseAxisId(*axis) : std::nullopt;
      if (!id) return std::nullopt;
      return EntityRef::toAxis(*id);
    }
    case RefKind::SketchEntity: {
      const std::string* sketch = stringField(raw, "sketch");
      const std::string* entity = stringField(raw, "entity");
      if (!isNonEmpty(sketch) || !isNonEmpty(entity)) return std::nullopt;
      return EntityRef::toSketchEntity(FeatureId(*sketch), *entity);
    }
  }
  return std::nullopt;
}

std::optional<EntityRef> readRefOf(const std::vector<RefKind>& kinds, const Json& raw) {
  for (const RefKind kind : kinds) {
    if (auto ref = readRef(kind, raw)) return ref;
  }
  return std::nullopt;
}

Json refJson(const EntityRef& ref) {
  Json out = {{"kind", std::string(refKindName(ref.kind))}};
  switch (ref.kind) {
    case RefKind::Body: out["body"] = ref.body.str(); break;
    case RefKind::Topo:
      out["body"] = ref.body.str();
      out["name"] = ref.name.str();
      break;
    case RefKind::Region:
      out["sketch"] = ref.sketch.str();
      out["region"] = ref.region;
      break;
    case RefKind::Plane: out["plane"] = ref.plane.str(); break;
    case RefKind::Axis: out["axis"] = ref.axis.str(); break;
    case RefKind::SketchEntity:
      out["sketch"] = ref.sketch.str();
      out["entity"] = ref.entity;
      break;
  }
  return out;
}

}  // namespace tinycad::document
