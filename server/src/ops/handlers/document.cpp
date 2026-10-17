// document.rename (src/ops/handlers/document.ts): the name of the document (M19.2), metadata
// outside undo, yet changed only by a handler, so the log, replay, snapshots and the file all
// carry the current name.

#include <memory>
#include <string>

#include "handlers/handlers.hpp"
#include "handlers/shape.hpp"
#include "tinycad/core/text.hpp"

namespace tinycad::ops::handlers {

namespace {

/** A name the UI accepts: not empty and `name.trim() === name`. */
bool isDocumentName(std::string_view name) { return !name.empty() && core::isTrimmed(name); }

shape::Check documentName() {
  return [](const Json* value, const std::string& path) {
    if (value != nullptr && value->is_string() &&
        isDocumentName(value->get_ref<const std::string&>())) {
      return shape::Errors{};
    }
    return shape::Errors{
        OperationLoadError{path, "Must be a non-empty string without spaces at the ends"}};
  };
}

class DocumentRenameHandler final : public shape::ShapedHandler {
 public:
  DocumentRenameHandler() : ShapedHandler("document.rename", {{"name", documentName()}}) {}

  [[nodiscard]] core::Result<Operation, OperationLoadError> invert(
      const document::DocumentReader& doc, const Operation& /*op*/) const override {
    return Json{{"type", "document.rename"}, {"v", version()}, {"name", doc.meta().name}};
  }

  core::Result<void, OperationLoadError> apply(document::DocumentWriter& doc,
                                               const Operation& op) const override {
    doc.rename(op.at("name").get<std::string>());
    return {};
  }
};

}  // namespace

std::vector<OpHandlerPtr> documentHandlers() { return {std::make_shared<DocumentRenameHandler>()}; }

}  // namespace tinycad::ops::handlers
