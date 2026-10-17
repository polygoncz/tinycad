#include "tinycad/document/serialize.hpp"

#include <cstddef>
#include <limits>
#include <set>
#include <string>
#include <utility>

#include "tinycad/document/origin.hpp"
#include "tinycad/document/refs.hpp"

// Loading and saving documents (spec 03 "Serializace", src/document/serialize.ts). fromData
// reports EVERY problem with its path, like TS, so the shared cases document.load compare the
// same paths.

namespace tinycad::document {

namespace {

/** The value under `key` of an object, nullptr when absent. */
const Json* field(const Json& object, const char* key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

bool isString(const Json* v) { return v != nullptr && v->is_string(); }

bool isNonEmptyString(const Json* v) {
  return isString(v) && !v->get_ref<const std::string&>().empty();
}

bool isBool(const Json* v) { return v != nullptr && v->is_boolean(); }

/**
 * A whole number >= min that also fits an int (a typeVersion above 2^31 − 1 is no version any
 * schema has; TS would take it and report it as newer than the schema).
 */
bool isIntAtLeast(const Json* v, int min) {
  if (v == nullptr || !core::isWholeNumber(*v)) return false;
  const double d = core::numberOf(*v);
  return d >= min && d <= std::numeric_limits<int>::max();
}

bool isFeatureIdText(const Json* v) {
  return isNonEmptyString(v) && v->get_ref<const std::string&>().find('/') == std::string::npos &&
         v->get_ref<const std::string&>() != ORIGIN;
}

std::string str(const Json* v) { return v->get<std::string>(); }

/** Collects the issues of one fromData call. */
class IssueList {
 public:
  void at(std::string path, std::string message) {
    issues_.push_back(DocumentLoadIssue{std::move(path), std::move(message)});
  }
  [[nodiscard]] bool empty() const { return issues_.empty(); }
  [[nodiscard]] DocumentLoadError error() && { return DocumentLoadError{std::move(issues_)}; }

 private:
  std::vector<DocumentLoadIssue> issues_;
};

std::optional<DocumentMeta> readMeta(const Json* raw, IssueList& issues) {
  if (raw == nullptr || !raw->is_object()) {
    issues.at("meta", "Must be an object");
    return std::nullopt;
  }
  const Json* id = field(*raw, "id");
  const Json* name = field(*raw, "name");
  const Json* createdAt = field(*raw, "createdAt");
  const bool idOk = isNonEmptyString(id);
  const bool nameOk = isString(name);
  const bool createdAtOk = createdAt != nullptr && core::isFiniteNumber(*createdAt);
  if (!idOk) issues.at("meta.id", "Must be a non-empty string");
  if (!nameOk) issues.at("meta.name", "Must be a string");
  if (!createdAtOk) issues.at("meta.createdAt", "Must be a number");
  if (!idOk || !nameOk || !createdAtOk) return std::nullopt;
  // The single trusted place where a loaded id becomes typed.
  return DocumentMeta{DocumentId(str(id)), str(name), core::numberOf(*createdAt)};
}

/** The canonical metadata of one body, nullopt when broken (reported) or empty. */
std::optional<BodyMeta> readBodyMeta(const Json& raw, const std::string& path,
                                     IssueList& issues) {
  if (!raw.is_object()) {
    issues.at(path, "Must be an object");
    return std::nullopt;
  }
  bool valid = true;
  for (const auto& item : raw.items()) {
    const std::string& key = item.key();
    if (key != "name" && key != "hidden" && key != "color" && key != "material") {
      issues.at(path + "." + key, "Unexpected property");
      valid = false;
    }
  }
  const Json* name = field(raw, "name");
  const Json* hidden = field(raw, "hidden");
  const Json* color = field(raw, "color");
  const Json* material = field(raw, "material");
  if (name != nullptr && !isNonEmptyString(name)) {
    issues.at(path + ".name", "Must be a non-empty string");
    valid = false;
  }
  if (hidden != nullptr && !hidden->is_boolean()) {
    issues.at(path + ".hidden", "Must be true or false");
    valid = false;
  }
  if (color != nullptr && !(color->is_string() && isBodyColor(color->get_ref<const std::string&>()))) {
    issues.at(path + ".color", "Must be a color '#rrggbb' in lower case");
    valid = false;
  }
  std::optional<BodyMaterial> parsedMaterial;
  if (material != nullptr) {
    if (material->is_string()) parsedMaterial = parseBodyMaterial(material->get_ref<const std::string&>());
    if (!parsedMaterial) {
      issues.at(path + ".material",
                "Must be one of plastic, aluminium, steel, brass, glass, rubber");
      valid = false;
    }
  }
  if (!valid) return std::nullopt;
  BodyMeta meta;
  if (name != nullptr) meta.name = str(name);
  meta.hidden = hidden != nullptr && hidden->get<bool>();
  if (color != nullptr) meta.color = str(color);
  if (parsedMaterial && *parsedMaterial != DEFAULT_BODY_MATERIAL) meta.material = parsedMaterial;
  if (meta.empty()) return std::nullopt;
  return meta;
}

/**
 * Body metadata (spec 03, M11) in canonical form: absent → empty map, `hidden: false` and entries
 * left empty dropped. Keys must be body ids; nullopt only when `bodies` is not an object.
 */
BodyMetaMap readBodies(const Json* raw, IssueList& issues) {
  BodyMetaMap bodies;
  if (raw == nullptr) return bodies;
  if (!raw->is_object()) {
    issues.at("studio.bodies", "Must be an object");
    return bodies;
  }
  for (const auto& item : raw->items()) {
    const std::string path = "studio.bodies['" + item.key() + "']";
    const auto body = parseBodyId(item.key());
    if (!body) {
      issues.at(path, "Must be a body id '<feature>/body' or '<feature>/body:<n>'");
      continue;
    }
    if (auto meta = readBodyMeta(item.value(), path, issues)) bodies[*body] = std::move(*meta);
  }
  return bodies;
}

FeaturePtr readFeatureInto(const Json& raw, const std::string& path,
                           const FeatureSchemaRegistryReader& schemas, IssueList& issues) {
  if (!raw.is_object()) {
    issues.at(path, "Must be an object");
    return nullptr;
  }
  // `path` is empty when the feature is read on its own (readFeature).
  const auto under = [&path](const std::string& key) {
    return path.empty() ? key : path + "." + key;
  };
  const Json* id = field(raw, "id");
  const Json* type = field(raw, "type");
  const Json* typeVersion = field(raw, "typeVersion");
  const Json* name = field(raw, "name");
  const Json* params = field(raw, "params");
  const Json* suppressed = field(raw, "suppressed");
  // Report every bad field first, then give up on the feature at once. The owner of an artifact
  // id is the text before the first '/', so a feature id has none, and 'origin' owns the origin
  // geometry (spec 03).
  const bool idOk = isFeatureIdText(id);
  const bool typeOk = isNonEmptyString(type);
  const bool versionOk = isIntAtLeast(typeVersion, 1);
  const bool nameOk = isString(name);
  const bool paramsOk = params != nullptr && isJsonObject(*params);
  const bool suppressedOk = isBool(suppressed);
  if (!idOk) issues.at(under("id"), "Must be a non-empty string without '/', other than 'origin'");
  if (!typeOk) issues.at(under("type"), "Must be a non-empty string");
  if (!versionOk) issues.at(under("typeVersion"), "Must be a whole number >= 1");
  if (!nameOk) issues.at(under("name"), "Must be a string");
  if (!paramsOk) issues.at(under("params"), "Must be a plain JSON object");
  if (!suppressedOk) issues.at(under("suppressed"), "Must be true or false");
  if (!idOk || !typeOk || !versionOk || !nameOk || !paramsOk || !suppressedOk) return nullptr;

  const FeatureData data{str(type), static_cast<int>(core::numberOf(*typeVersion)), *params};
  auto migrated = migrateFeatureData(schemas, data);
  if (!migrated) {
    // Paths of the migration issues are made relative to the document.
    issues.at(under(migrated.error().path), migrated.error().message);
    return nullptr;
  }
  auto feature = std::make_shared<FeatureInstance>();
  feature->id = FeatureId(str(id));
  feature->type = std::move(migrated->type);
  feature->typeVersion = migrated->typeVersion;
  feature->name = str(name);
  feature->params = std::make_shared<const Json>(std::move(migrated->params));
  feature->suppressed = suppressed->get<bool>();
  return feature;
}

std::optional<PartStudioData> readStudio(const Json* raw,
                                         const FeatureSchemaRegistryReader& schemas,
                                         IssueList& issues) {
  if (raw == nullptr || !raw->is_object()) {
    issues.at("studio", "Must be an object");
    return std::nullopt;
  }
  const Json* rawFeatures = field(*raw, "features");
  if (rawFeatures == nullptr || !rawFeatures->is_array()) {
    issues.at("studio.features", "Must be an array");
    return std::nullopt;
  }
  PartStudioData studio;
  std::set<FeatureId> seen;
  for (std::size_t i = 0; i < rawFeatures->size(); ++i) {
    const std::string path = "studio.features[" + std::to_string(i) + "]";
    FeaturePtr f = readFeatureInto((*rawFeatures)[i], path, schemas, issues);
    if (!f) continue;
    if (!seen.insert(f->id).second) {
      issues.at(path + ".id", "Duplicate feature id '" + f->id.str() + "'");
    }
    studio.features.push_back(std::move(f));
  }
  const Json* rollbackIndex = field(*raw, "rollbackIndex");
  const std::size_t length = rawFeatures->size();
  if (rollbackIndex == nullptr || !core::isWholeNumber(*rollbackIndex) ||
      core::numberOf(*rollbackIndex) < 0 ||
      core::numberOf(*rollbackIndex) > static_cast<double>(length)) {
    issues.at("studio.rollbackIndex", "Must be a whole number in 0.." + std::to_string(length));
    return std::nullopt;
  }
  studio.rollbackIndex = static_cast<int>(core::numberOf(*rollbackIndex));
  studio.bodies = readBodies(field(*raw, "bodies"), issues);
  return studio;
}

Json bodyMetaJson(const BodyMeta& meta) {
  Json out = Json::object();
  if (meta.name) out["name"] = *meta.name;
  if (meta.hidden) out["hidden"] = true;
  if (meta.color) out["color"] = *meta.color;
  if (meta.material) out["material"] = std::string(bodyMaterialName(*meta.material));
  return out;
}

}  // namespace

Json featureJson(const FeatureInstance& f) {
  return {{"id", f.id.str()},
          {"type", f.type},
          {"typeVersion", f.typeVersion},
          {"name", f.name},
          {"params", f.params ? *f.params : Json::object()},
          {"suppressed", f.suppressed}};
}

core::Result<FeaturePtr, DocumentLoadError> readFeature(
    const Json& raw, const FeatureSchemaRegistryReader& schemas) {
  IssueList issues;
  FeaturePtr feature = readFeatureInto(raw, "", schemas, issues);
  if (!feature) return core::fail(std::move(issues).error());
  return feature;
}

DocumentData toData(const DocumentReader& doc) { return DocumentData{doc.meta(), doc.studio()}; }

Json documentDataJson(const DocumentData& data) {
  Json features = Json::array();
  for (const FeaturePtr& f : data.studio->features) features.push_back(featureJson(*f));
  Json studio = {{"features", features}, {"rollbackIndex", data.studio->rollbackIndex}};
  if (!data.studio->bodies.empty()) {
    Json bodies = Json::object();
    for (const auto& [body, meta] : data.studio->bodies) bodies[body.str()] = bodyMetaJson(meta);
    studio["bodies"] = bodies;
  }
  return {{"meta",
           {{"id", data.meta.id.str()},
            {"name", data.meta.name},
            {"createdAt", core::numberJson(data.meta.createdAt)}}},
          {"studio", studio}};
}

core::Result<std::unique_ptr<Document>, DocumentLoadError> fromData(
    const Json& data, const FeatureSchemaRegistryReader& schemas) {
  IssueList issues;
  if (!data.is_object()) {
    issues.at("", "Document data must be an object");
    return core::fail(std::move(issues).error());
  }
  auto meta = readMeta(field(data, "meta"), issues);
  auto studio = readStudio(field(data, "studio"), schemas, issues);
  if (!meta || !studio || !issues.empty()) return core::fail(std::move(issues).error());
  return std::make_unique<Document>(std::move(*meta),
                                    std::make_shared<const PartStudioData>(std::move(*studio)));
}

core::Result<FeatureData, DocumentLoadIssue> migrateFeatureData(
    const FeatureSchemaRegistryReader& schemas, const FeatureData& data) {
  const FeatureSchema* schema = schemas.find(data.type);
  // Unknown type: kept as is, regeneration reports it.
  if (schema == nullptr || data.typeVersion == schema->version()) return data;
  const std::string from = std::to_string(data.typeVersion);
  if (data.typeVersion > schema->version()) {
    // Should not happen: the app always runs the latest version (Q025).
    return core::fail(DocumentLoadIssue{
        "typeVersion",
        "Version " + from + " is newer than the known " + std::to_string(schema->version())});
  }
  auto params = schema->migrate(data.typeVersion, data.params);
  if (!params) {
    return core::fail(
        DocumentLoadIssue{"params", "Migration from version " + from + " failed: " + params.error()});
  }
  if (!isJsonObject(*params)) {
    return core::fail(DocumentLoadIssue{
        "params", "Migration from version " + from + " did not return a plain JSON object"});
  }
  return FeatureData{data.type, schema->version(), std::move(*params)};
}

}  // namespace tinycad::document
