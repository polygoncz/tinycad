// The body.* handlers (src/ops/handlers/body.ts): body metadata (M11, M15, M24, spec 03). The
// document does not know bodies, so a body without metadata, even one no feature produces, is no
// error. Every apply takes the current metadata and overrides only its own field, so the other
// fields survive; setBodyMeta keeps the canonical form. The rollback bar never moves here.

#include <memory>
#include <string>

#include "handlers/handlers.hpp"
#include "handlers/shape.hpp"

namespace tinycad::ops::handlers {

namespace {

using document::BodyId;
using document::BodyMeta;
using document::DocumentReader;
using document::DocumentWriter;

using VoidResult = core::Result<void, OperationLoadError>;
using OpResult = core::Result<Operation, OperationLoadError>;

/** The body of a validated operation (bodyIdText checked its shape). */
BodyId bodyOf(const Operation& op) { return BodyId(op.at("body").get<std::string>()); }

/** The inverse: the same type and body with `value` under `key`. */
Json inverseOf(const shape::ShapedHandler& handler, const Operation& op, const char* key,
               Json value) {
  return {{"type", std::string(handler.type())},
          {"v", handler.version()},
          {"body", op.at("body")},
          {key, std::move(value)}};
}

class BodyRenameHandler final : public shape::ShapedHandler {
 public:
  BodyRenameHandler()
      : ShapedHandler("body.rename", {{"body", shape::bodyIdText()}, {"name", shape::string()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    return inverseOf(*this, op, "name", doc.bodyMeta(bodyOf(op)).name.value_or(""));
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    BodyMeta meta = doc.bodyMeta(bodyOf(op));
    // '' drops the name: setBodyMeta keeps the canonical form.
    meta.name = op.at("name").get<std::string>();
    doc.setBodyMeta(bodyOf(op), meta);
    return {};
  }
};

class BodySetVisibleHandler final : public shape::ShapedHandler {
 public:
  BodySetVisibleHandler()
      : ShapedHandler("body.setVisible",
                      {{"body", shape::bodyIdText()}, {"visible", shape::boolean()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    return inverseOf(*this, op, "visible", !doc.bodyMeta(bodyOf(op)).hidden);
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    BodyMeta meta = doc.bodyMeta(bodyOf(op));
    meta.hidden = !op.at("visible").get<bool>();
    doc.setBodyMeta(bodyOf(op), meta);
    return {};
  }
};

// The same color is a valid operation: setBodyMeta then changes nothing.
class BodySetColorHandler final : public shape::ShapedHandler {
 public:
  BodySetColorHandler()
      : ShapedHandler("body.setColor",
                      {{"body", shape::bodyIdText()}, {"color", shape::bodyColorOrNull()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    const auto color = doc.bodyMeta(bodyOf(op)).color;
    return inverseOf(*this, op, "color", color ? Json(*color) : Json(nullptr));
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    BodyMeta meta = doc.bodyMeta(bodyOf(op));
    const Json& color = op.at("color");
    if (color.is_null()) {
      meta.color.reset();
    } else {
      meta.color = color.get<std::string>();
    }
    doc.setBodyMeta(bodyOf(op), meta);
    return {};
  }
};

// The same material is a valid operation too; 'plastic' is dropped by the canonical form.
class BodySetMaterialHandler final : public shape::ShapedHandler {
 public:
  BodySetMaterialHandler()
      : ShapedHandler("body.setMaterial",
                      {{"body", shape::bodyIdText()}, {"material", shape::bodyMaterial()}}) {}

  [[nodiscard]] OpResult invert(const DocumentReader& doc, const Operation& op) const override {
    const auto material =
        doc.bodyMeta(bodyOf(op)).material.value_or(document::DEFAULT_BODY_MATERIAL);
    return inverseOf(*this, op, "material", std::string(document::bodyMaterialName(material)));
  }

  VoidResult apply(DocumentWriter& doc, const Operation& op) const override {
    BodyMeta meta = doc.bodyMeta(bodyOf(op));
    meta.material = document::parseBodyMaterial(op.at("material").get<std::string>());
    doc.setBodyMeta(bodyOf(op), meta);
    return {};
  }
};

}  // namespace

std::vector<OpHandlerPtr> bodyHandlers() {
  return {std::make_shared<BodyRenameHandler>(), std::make_shared<BodySetVisibleHandler>(),
          std::make_shared<BodySetColorHandler>(), std::make_shared<BodySetMaterialHandler>()};
}

}  // namespace tinycad::ops::handlers
