// studio.setRollback (src/ops/handlers/studio.ts): the rollback bar of the Part Studio.

#include <memory>

#include "handlers/handlers.hpp"
#include "handlers/shape.hpp"

namespace tinycad::ops::handlers {

namespace {

class StudioSetRollbackHandler final : public shape::ShapedHandler {
 public:
  StudioSetRollbackHandler()
      : ShapedHandler("studio.setRollback", {{"index", shape::wholeNumber(0)}}) {}

  [[nodiscard]] core::Result<Operation, OperationLoadError> invert(
      const document::DocumentReader& doc, const Operation& /*op*/) const override {
    return Json{{"type", "studio.setRollback"},
                {"v", version()},
                {"index", doc.studio()->rollbackIndex}};
  }

  core::Result<void, OperationLoadError> apply(document::DocumentWriter& doc,
                                               const Operation& op) const override {
    const double index = core::numberOf(op.at("index"));
    if (index > static_cast<double>(doc.studio()->features.size())) {
      return core::fail(OperationLoadError{"index", "Rollback index out of range"});
    }
    doc.setRollbackIndex(static_cast<int>(index));
    return {};
  }
};

}  // namespace

std::vector<OpHandlerPtr> studioHandlers() { return {std::make_shared<StudioSetRollbackHandler>()}; }

}  // namespace tinycad::ops::handlers
