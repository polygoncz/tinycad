#include "tinycad/ops/apply.hpp"

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace tinycad::ops {

namespace {

using Result = core::Result<Operation, OperationLoadError>;

std::vector<document::FeatureId> featureOrder(const document::DocumentReader& doc) {
  std::vector<document::FeatureId> ids;
  for (const auto& f : doc.studio()->features) ids.push_back(f->id);
  return ids;
}

/** Upcast belongs to loading only: a write is always in the current version of its type. */
std::optional<OperationLoadError> checkVersion(const Operation& op, int version) {
  const auto v = op.find("v");
  if (v != op.end() && core::isFiniteNumber(*v) && core::numberOf(*v) == version) {
    return std::nullopt;
  }
  return OperationLoadError{"v", "Version " + (v == op.end() ? std::string("missing") : v->dump()) +
                                     ", expected " + std::to_string(version)};
}

/**
 * What loading refuses or changes must not be written (M19.1): the current version of the handler
 * and the same validate as upcastOperation. The error carries the path of the first problem and
 * the list of all of them.
 */
std::optional<OperationLoadError> checkValid(const OpHandler& handler, const Operation& op) {
  if (auto error = checkVersion(op, handler.version())) return error;
  const auto errors = handler.validate(op);
  if (errors.empty()) return std::nullopt;
  std::string list;
  for (const auto& e : errors) list += (list.empty() ? "" : "; ") + e.path + ": " + e.message;
  return OperationLoadError{errors.front().path,
                            "Invalid operation '" + std::string(handler.type()) + "': " + list};
}

Result applySingle(document::DocumentWriter& doc, const OpHandlerRegistry& handlers,
                   const std::string& type, const Operation& op) {
  const OpHandler* handler = handlers.find(type);
  if (handler == nullptr) {
    return core::fail(OperationLoadError{"type", "Unknown operation type '" + type + "'"});
  }
  // Nothing has changed yet when any of these fail.
  if (auto error = checkValid(*handler, op)) return core::fail(std::move(*error));
  auto handlerInverse = handler->invert(doc, op);
  if (!handlerInverse) return handlerInverse;

  const int barBefore = doc.studio()->rollbackIndex;
  const auto orderBefore = featureOrder(doc);
  const auto studioBefore = doc.studio();
  const std::string nameBefore = doc.meta().name;
  if (auto applied = handler->apply(doc, op); !applied) {
    TINYCAD_ASSERT(doc.studio() == studioBefore && doc.meta().name == nameBefore,
                   "Handler '" + type + "' failed after changing the document");
    return core::fail(applied.error());
  }

  // A structural change (count or order of features) counts too: the handler's inverse may shift
  // the bar even when the forward change did not.
  const bool structureChanged = featureOrder(doc) != orderBefore;
  const bool barMoved = doc.studio()->rollbackIndex != barBefore;
  if (type == "studio.setRollback" || !(barMoved || structureChanged)) return handlerInverse;

  // Mutators shift the bar by rules that are not exactly invertible (Q029): restore it explicitly.
  const Json restoreBar = {
      {"type", "studio.setRollback"}, {"v", opVersion("studio.setRollback")}, {"index", barBefore}};
  return Json{{"type", "batch"},
              {"v", opVersion("batch")},
              {"ops", Json::array({std::move(*handlerInverse), restoreBar})}};
}

Result applyBatch(document::DocumentWriter& doc, const OpHandlerRegistry& handlers,
                  const Operation& op) {
  if (auto error = checkVersion(op, opVersion("batch"))) return core::fail(std::move(*error));
  const auto ops = op.find("ops");
  if (ops == op.end() || !ops->is_array()) {
    return core::fail(OperationLoadError{"ops", "Must be an array"});
  }
  std::vector<Operation> inverses;
  for (std::size_t i = 0; i < ops->size(); ++i) {
    auto result = applyOperation(doc, handlers, (*ops)[i]);
    if (!result) {
      // Atomic: revert the applied sub-operations. An inverse of an applied operation always
      // applies; one that does not is a bug.
      for (auto it = inverses.rbegin(); it != inverses.rend(); ++it) {
        const auto reverted = applyOperation(doc, handlers, *it);
        TINYCAD_ASSERT(reverted.has_value(),
                       "Reverting a batch failed: " + (reverted ? "" : reverted.error().message));
      }
      const std::string prefix = "ops[" + std::to_string(i) + "]";
      const std::string& path = result.error().path;
      return core::fail(
          OperationLoadError{path.empty() ? prefix : prefix + "." + path, result.error().message});
    }
    inverses.push_back(std::move(*result));
  }
  Json reversed = Json::array();
  for (auto it = inverses.rbegin(); it != inverses.rend(); ++it) reversed.push_back(std::move(*it));
  return Json{{"type", "batch"}, {"v", opVersion("batch")}, {"ops", std::move(reversed)}};
}

}  // namespace

Result applyOperation(document::DocumentWriter& doc, const OpHandlerRegistry& handlers,
                      const Operation& op) {
  if (!op.is_object()) return core::fail(OperationLoadError{"", "Must be an object"});
  const auto type = op.find("type");
  if (type == op.end() || !type->is_string()) {
    return core::fail(OperationLoadError{"type", "Must be a string"});
  }
  const std::string& name = type->get_ref<const std::string&>();
  return name == "batch" ? applyBatch(doc, handlers, op) : applySingle(doc, handlers, name, op);
}

}  // namespace tinycad::ops
