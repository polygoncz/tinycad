#pragma once

// Small shape checks for validate of the built-in handlers (Q032, src/ops/handlers/shape.ts).
// Only the shape of the payload, never its relation to the document (that is apply's job).
// Internal to tinycad_ops.

#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops::shape {

using Errors = std::vector<OperationLoadError>;

/** Checks the value found at `path` (nullptr = the key is missing); its problems, empty when fine. */
using Check = std::function<Errors(const Json* value, const std::string& path)>;

/** One field of an object; the fields are checked in the order of the list (first problem wins). */
struct Field {
  std::string key;
  Check check;
};

Check nonEmptyString();
/** A new feature id: non-empty, without '/', other than 'origin' (spec 03, M12). */
Check featureIdText();
/** A body id '<owner>/body[:<n>]' (spec 03). */
Check bodyIdText();
/** A body color '#rrggbb' in lower case or null for the default (M15). */
Check bodyColorOrNull();
/** A body material preset (M24); the default is 'plastic', there is no null. */
Check bodyMaterial();
Check string();
Check boolean();
/** Feature params: a plain JSON object as fromData demands (spec 03). */
Check jsonObject();
Check wholeNumber(int min);
/** An object whose listed fields pass their checks; other fields are ignored. */
Check object(std::vector<Field> fields);

/** validate of a handler: the payload fields of the operation, paths relative to it. */
Errors validateShape(const std::vector<Field>& fields, const Operation& op);

/** The value under `key` of an object; nullptr when absent. */
const Json* field(const Json& object, const char* key);

/**
 * The common base of the built-in handlers: the type, its version from OP_VERSION and validate by
 * the list of payload fields. Each operation type is a subclass with invert and apply.
 */
class ShapedHandler : public OpHandler {
 public:
  [[nodiscard]] std::string_view type() const override { return type_; }
  [[nodiscard]] int version() const override { return opVersion(type_); }
  [[nodiscard]] std::vector<OperationLoadError> validate(const Operation& op) const override {
    return validateShape(fields_, op);
  }

 protected:
  ShapedHandler(std::string type, std::vector<Field> fields)
      : type_(std::move(type)), fields_(std::move(fields)) {}

 private:
  std::string type_;
  std::vector<Field> fields_;
};

}  // namespace tinycad::ops::shape
