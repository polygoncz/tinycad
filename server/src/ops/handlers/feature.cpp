// The feature.* handlers (src/ops/handlers/feature.ts). feature.add and feature.setParams
// migrate the feature data they carry to the current schema version when applied (Q035): the log
// lives forever, so old entries carry old params.

#include <limits>
#include <memory>
#include <string>
#include <utility>

#include "handlers/handlers.hpp"
#include "handlers/shape.hpp"
#include "tinycad/document/serialize.hpp"

namespace tinycad::ops::handlers {

namespace {

using document::DocumentReader;
using document::DocumentWriter;
using document::FeatureId;
using document::FeatureInstance;
using document::FeaturePtr;
using document::FeatureSchemaRegistryReader;

using VoidResult = core::Result<void, OperationLoadError>;
using OpResult = core::Result<Operation, OperationLoadError>;

std::string text(const Operation& op, const char* key) { return op.at(key).get<std::string>(); }

FeatureId featureIdOf(const Operation& op) { return FeatureId(text(op, "featureId")); }

/** A whole number of a validated operation as an int; nullopt when it does not fit. */
std::optional<int> intOf(const Json& value) {
  const double d = core::numberOf(value);
  if (d > std::numeric_limits<int>::max()) return std::nullopt;
  return static_cast<int>(d);
}

/** invert and apply run with a validated operation; a missing feature is a failure of the op. */
core::Result<FeaturePtr, OperationLoadError> requireFeature(const DocumentReader& doc,
                                                            const Operation& op) {
  const FeatureId id = featureIdOf(op);
  FeaturePtr f = doc.feature(id);
  if (!f) return core::fail(OperationLoadError{"featureId", "Feature '" + id.str() + "' does not exist"});
  return f;
}

Json featureJson(const FeatureInstance& f) {
  return {{"id", f.id.str()},     {"type", f.type},     {"typeVersion", f.typeVersion},
          {"name", f.name},       {"params", *f.params}, {"suppressed", f.suppressed}};
}

/**
 * Feature data of an operation on the current version of its schema (Q035); a failed migration
 * is a failure of the operation before any change, at `prefix` + the path of the issue.
 */
core::Result<document::FeatureData, OperationLoadError> migrated(
    const FeatureSchemaRegistryReader& schemas, const document::FeatureData& data,
    const std::string& prefix) {
  auto result = document::migrateFeatureData(schemas, data);
  if (!result) {
    return core::fail(OperationLoadError{prefix + result.error().path,
                                         "Feature of type '" + data.type + "': " + result.error().message});
  }
  return std::move(*result);
}

// ---------------------------------------------------------------------------------------------

class FeatureAddHandler final : public shape::ShapedHandler {
 public:
  explicit FeatureAddHandler(const FeatureSchemaRegistryReader& schemas)
      : ShapedHandler("feature.add",
                       {{"feature", shape::object({{"id", shape::featureIdText()},
                                                   {"type", shape::nonEmptyString()},
                                                   {"typeVersion", shape::wholeNumber(1)},
                                                   {"name", shape::string()},
                                                   {"suppressed", shape::boolean()},
                                                   {"params", shape::jsonObject()}})},
                        {"index", shape::wholeNumber(0)}}),
        schemas_(schemas) {}

  [[nodiscard]] OpResult invert(const DocumentReader& /*doc*/, const Operation& op) const override {
    return Json{{"type", "feature.remove"},
                {"v", opVersion("feature.remove")},
                {"featureId", op.at("feature").at("id")}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    const Json& raw = op.at("feature");
    const auto typeVersion = intOf(raw.at("typeVersion"));
    if (!typeVersion) return core::fail(OperationLoadError{"feature.typeVersion", "Too large"});
    const double index = core::numberOf(op.at("index"));
    if (index > static_cast<double>(doc.studio()->features.size())) {
      return core::fail(OperationLoadError{"index", "Index out of range"});
    }
    const FeatureId id(text(raw, "id"));
    if (doc.indexOf(id) != -1) {
      return core::fail(OperationLoadError{"feature.id", "Duplicate feature id '" + id.str() + "'"});
    }
    auto data = migrated(schemas_, {text(raw, "type"), *typeVersion, raw.at("params")}, "feature.");
    if (!data) return core::fail(data.error());
    auto f = std::make_shared<FeatureInstance>();
    f->id = id;
    f->type = std::move(data->type);
    f->typeVersion = data->typeVersion;
    f->name = text(raw, "name");
    f->params = std::make_shared<const Json>(std::move(data->params));
    f->suppressed = raw.at("suppressed").get<bool>();
    doc.insertFeature(static_cast<int>(index), std::move(f));
    return {};
  }

 private:
  const FeatureSchemaRegistryReader& schemas_;
};

class FeatureRemoveHandler final : public shape::ShapedHandler {
 public:
  FeatureRemoveHandler() : ShapedHandler("feature.remove", {{"featureId", shape::nonEmptyString()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    return Json{{"type", "feature.add"},
                {"v", opVersion("feature.add")},
                {"feature", featureJson(**f)},
                {"index", doc.indexOf((*f)->id)}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    doc.removeFeature((*f)->id);
    return {};
  }
};

class FeatureSetParamsHandler final : public shape::ShapedHandler {
 public:
  explicit FeatureSetParamsHandler(const FeatureSchemaRegistryReader& schemas)
      : ShapedHandler("feature.setParams", {{"featureId", shape::nonEmptyString()},
                                             {"typeVersion", shape::wholeNumber(1)},
                                             {"params", shape::jsonObject()}}),
        schemas_(schemas) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    return Json{{"type", "feature.setParams"},
                {"v", version()},
                {"featureId", (*f)->id.str()},
                {"typeVersion", (*f)->typeVersion},
                {"params", *(*f)->params}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    const auto typeVersion = intOf(op.at("typeVersion"));
    if (!typeVersion) return core::fail(OperationLoadError{"typeVersion", "Too large"});
    // The type comes from the document: the operation only knows the feature by its id.
    auto data = migrated(schemas_, {(*f)->type, *typeVersion, op.at("params")}, "");
    if (!data) return core::fail(data.error());
    auto next = std::make_shared<FeatureInstance>(**f);
    next->typeVersion = data->typeVersion;
    next->params = std::make_shared<const Json>(std::move(data->params));
    doc.replaceFeature(std::move(next));
    return {};
  }

  /** Same feature: the later params win; the inverse of the first op still restores the start. */
  [[nodiscard]] std::optional<Operation> merge(const Operation& prev,
                                               const Operation& next) const override {
    // in_place: an optional<json> from a json would be ambiguous (json converts to anything).
    if (prev.at("featureId") == next.at("featureId")) return std::optional<Operation>(std::in_place, next);
    return std::nullopt;
  }

  // Version 1 had no typeVersion. It existed only while every feature schema had version 1, so 1
  // is right: the version of an operation carrying feature data goes up before any schema leaves
  // version 1 (Q035).
  [[nodiscard]] bool hasUpcast() const override { return true; }
  [[nodiscard]] Operation upcast(int fromVersion, const Operation& raw) const override {
    TINYCAD_ASSERT(fromVersion == 1, "feature.setParams: no upcast from version " +
                                         std::to_string(fromVersion));
    Operation out = raw;
    out["v"] = version();
    out["typeVersion"] = 1;
    return out;
  }

 private:
  const FeatureSchemaRegistryReader& schemas_;
};

class FeatureRenameHandler final : public shape::ShapedHandler {
 public:
  FeatureRenameHandler()
      : ShapedHandler("feature.rename",
                       {{"featureId", shape::nonEmptyString()}, {"name", shape::string()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    return Json{{"type", "feature.rename"},
                {"v", version()},
                {"featureId", (*f)->id.str()},
                {"name", (*f)->name}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    auto next = std::make_shared<FeatureInstance>(**f);
    next->name = text(op, "name");
    doc.replaceFeature(std::move(next));
    return {};
  }
};

class FeatureSuppressHandler final : public shape::ShapedHandler {
 public:
  FeatureSuppressHandler()
      : ShapedHandler("feature.suppress",
                       {{"featureId", shape::nonEmptyString()}, {"suppressed", shape::boolean()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    return Json{{"type", "feature.suppress"},
                {"v", version()},
                {"featureId", (*f)->id.str()},
                {"suppressed", (*f)->suppressed}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    auto next = std::make_shared<FeatureInstance>(**f);
    next->suppressed = op.at("suppressed").get<bool>();
    doc.replaceFeature(std::move(next));
    return {};
  }
};

class FeatureMoveHandler final : public shape::ShapedHandler {
 public:
  FeatureMoveHandler()
      : ShapedHandler("feature.move", {{"featureId", shape::nonEmptyString()},
                                        {"toIndex", shape::wholeNumber(0)}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    return Json{{"type", "feature.move"},
                {"v", version()},
                {"featureId", (*f)->id.str()},
                {"toIndex", doc.indexOf((*f)->id)}};
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    auto f = requireFeature(doc, op);
    if (!f) return core::fail(f.error());
    const double toIndex = core::numberOf(op.at("toIndex"));
    if (toIndex >= static_cast<double>(doc.studio()->features.size())) {
      return core::fail(OperationLoadError{"toIndex", "Index out of range"});
    }
    doc.moveFeature((*f)->id, static_cast<int>(toIndex));
    return {};
  }
};

}  // namespace

std::vector<OpHandlerPtr> featureHandlers(const FeatureSchemaRegistryReader& schemas) {
  return {std::make_shared<FeatureAddHandler>(schemas),
          std::make_shared<FeatureRemoveHandler>(),
          std::make_shared<FeatureSetParamsHandler>(schemas),
          std::make_shared<FeatureRenameHandler>(),
          std::make_shared<FeatureSuppressHandler>(),
          std::make_shared<FeatureMoveHandler>()};
}

}  // namespace tinycad::ops::handlers
