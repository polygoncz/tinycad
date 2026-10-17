#pragma once

// Test helpers of ops (the C++ twin of src/ops/testing.ts and the ad-hoc handlers of the TS ops
// tests): an empty schema registry, operation builders and a configurable test handler.

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "document/testing.hpp"
#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::testing {

using core::Json;

/** No feature schemas: the handlers migrate nothing (most ops tests). */
inline const document::FeatureSchemaRegistry& noSchemas() {
  static const document::FeatureSchemaRegistry registry;
  return registry;
}

/** The JSON of a feature as feature.add carries it. */
inline Json featureJson(const document::FeatureInstance& f) {
  return {{"id", f.id.str()},     {"type", f.type},      {"typeVersion", f.typeVersion},
          {"name", f.name},       {"params", *f.params}, {"suppressed", f.suppressed}};
}

inline Json renameOp(const std::string& featureId, const std::string& name) {
  return {{"type", "feature.rename"}, {"v", 1}, {"featureId", featureId}, {"name", name}};
}

inline Json setParamsOp(const std::string& featureId, Json params) {
  return {{"type", "feature.setParams"},
          {"v", 2},
          {"featureId", featureId},
          {"typeVersion", 1},
          {"params", std::move(params)}};
}

inline Json addOp(const document::FeatureInstance& f, int index) {
  return {{"type", "feature.add"}, {"v", 1}, {"feature", featureJson(f)}, {"index", index}};
}

inline Json removeOp(const std::string& featureId) {
  return {{"type", "feature.remove"}, {"v", 1}, {"featureId", featureId}};
}

inline Json moveOp(const std::string& featureId, int toIndex) {
  return {{"type", "feature.move"}, {"v", 1}, {"featureId", featureId}, {"toIndex", toIndex}};
}

inline Json suppressOp(const std::string& featureId, bool suppressed) {
  return {{"type", "feature.suppress"}, {"v", 1}, {"featureId", featureId}, {"suppressed", suppressed}};
}

inline Json rollbackOp(int index) {
  return {{"type", "studio.setRollback"}, {"v", 1}, {"index", index}};
}

inline Json batchOp(Json ops) { return {{"type", "batch"}, {"v", 1}, {"ops", std::move(ops)}}; }

/**
 * A ready-made session (anOpsSession of src/ops/testing.ts): document, handlers, log, dispatcher
 * and undo; LogEntry::time is deterministic (1, 2, 3, …). Not copyable: the parts refer to each
 * other.
 */
class OpsSession {
 public:
  explicit OpsSession(DocumentOptions options = {},
                      const document::FeatureSchemaRegistryReader& schemas = noSchemas())
      : doc(aDocument(std::move(options))),
        handlers(schemas),
        dispatcher(*doc, handlers, log, [this] { return ++clock; }),
        undo(dispatcher, log) {}
  OpsSession(const OpsSession&) = delete;
  OpsSession& operator=(const OpsSession&) = delete;

  std::unique_ptr<document::Document> doc;
  ops::OpHandlerRegistry handlers;
  ops::OperationLog log;
  double clock = 0;
  ops::OperationDispatcher dispatcher;
  ops::UndoManager undo;
};

/**
 * A handler of any type for tests (the object literals of the TS tests): inverts to itself,
 * applies nothing unless told to fail, optional upcast.
 */
class TestHandler final : public ops::OpHandler {
 public:
  using Upcast = std::function<ops::Operation(int, const ops::Operation&)>;

  TestHandler(std::string type, int version, Upcast upcast = nullptr, bool fail = false)
      : type_(std::move(type)), version_(version), upcast_(std::move(upcast)), fail_(fail) {}

  [[nodiscard]] std::string_view type() const override { return type_; }
  [[nodiscard]] int version() const override { return version_; }
  [[nodiscard]] core::Result<ops::Operation, ops::OperationLoadError> invert(
      const document::DocumentReader& /*doc*/, const ops::Operation& op) const override {
    return op;
  }
  core::Result<void, ops::OperationLoadError> apply(document::DocumentWriter& /*doc*/,
                                                    const ops::Operation& /*op*/) const override {
    if (fail_) return core::fail(ops::OperationLoadError{"", "boom"});
    return {};
  }
  [[nodiscard]] bool hasUpcast() const override { return static_cast<bool>(upcast_); }
  [[nodiscard]] ops::Operation upcast(int fromVersion, const ops::Operation& raw) const override {
    return upcast_(fromVersion, raw);
  }

 private:
  std::string type_;
  int version_;
  Upcast upcast_;
  bool fail_;
};

}  // namespace tinycad::testing
