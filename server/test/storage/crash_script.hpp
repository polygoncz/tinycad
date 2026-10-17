#pragma once

// The deterministic script of the crash test, shared by the helper process crash_writer (which
// kills itself after it) and crash_test.cpp (which plays it in-process as the reference). Each
// step is one durable call and writes exactly one log entry: dispatch, a transaction of three
// applies, undo, redo and document.rename. No GoogleTest here: crash_writer is a plain program.

#include <cstdint>
#include <memory>
#include <string>

#include "snapshot.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/storage/persistent_document.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::testing::crash {

using core::Json;

inline const document::DocumentId DOCUMENT_ID("crash");

inline const document::FeatureSchemaRegistry& schemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

inline const ops::OpHandlerRegistry& handlers() {
  static const ops::OpHandlerRegistry registry(schemas());
  return registry;
}

/** A fixed clock: the crashed and the reference log are then identical, time included. */
inline double fixedClock() { return 1000; }

/** Creates the empty document of the script in the catalog and opens it. */
inline std::unique_ptr<storage::PersistentDocument> createDocument(storage::DocumentCatalog& catalog,
                                                                   bool verify) {
  const document::DocumentMeta meta{DOCUMENT_ID, "Crash", 0};
  const document::DocumentData empty{meta, std::make_shared<const document::PartStudioData>()};
  auto file = catalog.create(meta, storage::snapshotJson(empty, 0), std::nullopt);
  if (!file) return nullptr;
  auto doc = storage::PersistentDocument::open(std::move(*file), {schemas(), handlers(), fixedClock, verify});
  return doc ? std::move(*doc) : nullptr;
}

inline storage::OperationKey keyOf(std::int64_t step) {
  return {"step-" + std::to_string(step), "fp-" + std::to_string(step)};
}

inline Json featureAdd(const std::string& id, int index) {
  return {{"type", "feature.add"},
          {"v", 1},
          {"feature",
           {{"id", id},
            {"type", "box"},
            {"typeVersion", 1},
            {"name", "Box " + id},
            {"params", {{"origin", {0, 0, 0}}, {"width", 10}, {"depth", 10}, {"height", 10}}},
            {"suppressed", false}}},
          {"index", index}};
}

inline Json rename(const std::string& featureId, const std::string& name) {
  return {{"type", "feature.rename"}, {"v", 1}, {"featureId", featureId}, {"name", name}};
}

/**
 * Change number `step` (1, 2, …): exactly one new log entry. False when a call failed (the test
 * then fails on the comparison, the writer exits with an error).
 */
inline bool runStep(storage::PersistentDocument& doc, std::int64_t step) {
  const std::string tag = std::to_string(step);
  const auto studio = doc.document().studio();
  const auto count = static_cast<int>(studio->features.size());
  const std::string first = count > 0 ? studio->features.front()->id.str() : "";
  const storage::OperationKey key = keyOf(step);
  switch (step % 7) {
    case 0: return doc.dispatch({{"type", "document.rename"}, {"v", 1}, {"name", "Crash " + tag}}, "", key).has_value();
    case 1: return doc.dispatch(featureAdd("f" + tag, count), "Add", key).has_value();
    case 2: {
      // Three steps of different types: committed as one batch entry.
      if (!doc.begin("Edit " + tag)) return false;
      const Json setParams = {{"type", "feature.setParams"}, {"v", 2}, {"featureId", first},
                              {"typeVersion", 1},
                              {"params", {{"origin", {0, 0, 0}}, {"width", step}, {"depth", 10}, {"height", 10}}}};
      const Json suppress = {{"type", "feature.suppress"}, {"v", 1}, {"featureId", first},
                             {"suppressed", step % 2 == 0}};
      if (!doc.apply(rename(first, "Edited " + tag)) || !doc.apply(setParams) || !doc.apply(suppress)) {
        return false;
      }
      return doc.commit(key).has_value();
    }
    case 3:
      if (doc.canUndo()) return doc.undo(key).has_value();
      return doc.dispatch(rename(first, "U" + tag), "", key).has_value();
    case 4:
      if (doc.canRedo()) return doc.redo(key).has_value();
      return doc.dispatch(rename(first, "R" + tag), "", key).has_value();
    case 5: return doc.dispatch(rename(first, "N" + tag), "", key).has_value();
    default:
      return doc.dispatch({{"type", "studio.setRollback"}, {"v", 1}, {"index", step % 3 == 0 ? count - 1 : count}},
                          "", key)
          .has_value();
  }
}

}  // namespace tinycad::testing::crash
