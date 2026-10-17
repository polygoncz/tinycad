#pragma once

// Test builders of document (the C++ twin of src/document/testing.ts): aFeature() and
// aDocument() with defaults; a test overrides only what it is about. Test-only: production code
// never includes this file.

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"

namespace tinycad::testing {

/** What aFeature() overrides; unset fields take the defaults. */
struct FeatureOverrides {
  std::optional<std::string> id;
  std::optional<std::string> type;
  std::optional<int> typeVersion;
  std::optional<std::string> name;
  /** null = the default { size: 1 }. */
  core::Json params;
  std::optional<bool> suppressed;
};

// Default ids depend on call order within a test binary. Tests that assert on ids or names pass
// them explicitly; the defaults only guarantee uniqueness.
inline int nextFeatureNumber = 0;

/** A valid feature: type 'box', version 1, params { size: 1 }, id 'f<n>', name 'Feature <n>'. */
inline document::FeaturePtr aFeature(FeatureOverrides overrides = {}) {
  const int n = ++nextFeatureNumber;
  auto f = std::make_shared<document::FeatureInstance>();
  f->id = document::FeatureId(overrides.id.value_or("f" + std::to_string(n)));
  f->type = overrides.type.value_or("box");
  f->typeVersion = overrides.typeVersion.value_or(1);
  f->name = overrides.name.value_or("Feature " + std::to_string(n));
  f->params =
      std::make_shared<const core::Json>(
      overrides.params.is_null() ? core::Json{{"size", 1}} : std::move(overrides.params));
  f->suppressed = overrides.suppressed.value_or(false);
  return f;
}

/** A feature with just an id (most tests). */
inline document::FeaturePtr aFeature(const std::string& id) {
  return aFeature(FeatureOverrides{.id = id});
}

struct DocumentOptions {
  std::optional<std::string> id;
  std::optional<std::string> name;
  std::optional<double> createdAt;
  std::vector<document::FeaturePtr> features;
  /** Defaults to features.size(): everything active. */
  std::optional<int> rollbackIndex;
};

/** A document with the given features; meta is { id 'doc1', name 'Test document', createdAt 0 }. */
inline std::unique_ptr<document::Document> aDocument(DocumentOptions options = {}) {
  auto studio = std::make_shared<document::PartStudioData>();
  studio->rollbackIndex = options.rollbackIndex.value_or(static_cast<int>(options.features.size()));
  studio->features = std::move(options.features);
  document::DocumentMeta meta{document::DocumentId(options.id.value_or("doc1")),
                              options.name.value_or("Test document"),
                              options.createdAt.value_or(0)};
  return std::make_unique<document::Document>(std::move(meta), std::move(studio));
}

/**
 * A feature schema for tests: the given params, validate = validateAgainstSchema, an optional
 * migrate (then any version). Stands in for the plugins, which tests of document and ops do not
 * depend on.
 */
class TestSchema final : public document::FeatureSchema {
 public:
  using Migrate = std::function<core::Result<core::Json, std::string>(int, const core::Json&)>;

  TestSchema(std::string type, int version, document::ParamSchema params = {},
             Migrate migrate = nullptr)
      : type_(std::move(type)),
        version_(version),
        params_(std::move(params)),
        migrate_(std::move(migrate)) {}

  [[nodiscard]] const std::string& type() const override { return type_; }
  [[nodiscard]] int version() const override { return version_; }
  [[nodiscard]] const std::string& label() const override { return type_; }
  [[nodiscard]] const std::string& icon() const override { return icon_; }
  [[nodiscard]] const document::ParamSchema& params() const override { return params_; }
  [[nodiscard]] core::Json defaults() const override { return core::Json::object(); }
  [[nodiscard]] std::vector<document::ParamIssue> validate(const core::Json& raw) const override {
    return document::validateAgainstSchema(params_, raw);
  }
  [[nodiscard]] bool hasMigrate() const override { return static_cast<bool>(migrate_); }
  [[nodiscard]] core::Result<core::Json, std::string> migrate(int fromVersion,
                                                              const core::Json& raw) const override {
    return migrate_(fromVersion, raw);
  }

 private:
  std::string type_;
  int version_;
  std::string icon_;
  document::ParamSchema params_;
  Migrate migrate_;
};

/** The ids of the features in order. */
inline std::vector<std::string> featureIds(const document::PartStudioData& studio) {
  std::vector<std::string> ids;
  for (const auto& f : studio.features) ids.push_back(f->id.str());
  return ids;
}

}  // namespace tinycad::testing
