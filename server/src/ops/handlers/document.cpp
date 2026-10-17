// document.rename (src/ops/handlers/document.ts): the name of the document (M19.2), metadata
// outside undo, yet changed only by a handler, so the log, replay, snapshots and the file all
// carry the current name.

#include <memory>
#include <string>

#include "handlers/handlers.hpp"
#include "handlers/shape.hpp"

namespace tinycad::ops::handlers {

namespace {

/**
 * The white space and line terminators String.prototype.trim removes (ECMAScript WhiteSpace and
 * LineTerminator), UTF-8 encoded.
 */
constexpr std::string_view kTrimmed[] = {
    "\t",           "\n",           "\v",           "\f",           "\r",           " ",
    "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80", "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
    "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89",
    "\xE2\x80\x8A", "\xE2\x80\xA8", "\xE2\x80\xA9", "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
    "\xEF\xBB\xBF"};

/** A name the UI accepts: not empty and `name.trim() === name`. */
bool isDocumentName(std::string_view name) {
  if (name.empty()) return false;
  for (const std::string_view space : kTrimmed) {
    if (name.starts_with(space) || name.ends_with(space)) return false;
  }
  return true;
}

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
