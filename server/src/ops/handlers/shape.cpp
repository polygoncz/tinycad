#include "handlers/shape.hpp"

#include <cmath>
#include <utility>

#include "tinycad/document/model.hpp"
#include "tinycad/document/origin.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/document/serialize.hpp"

namespace tinycad::ops::shape {

namespace {

/** A check from a test of the value and the message of its problem. */
Check check(std::function<bool(const Json* value)> test, std::string message) {
  return [test = std::move(test), message = std::move(message)](const Json* value,
                                                                const std::string& path) {
    return test(value) ? Errors{} : Errors{OperationLoadError{path, message}};
  };
}

bool isString(const Json* v) { return v != nullptr && v->is_string(); }

const std::string& text(const Json* v) { return v->get_ref<const std::string&>(); }

}  // namespace

const Json* field(const Json& object, const char* key) {
  if (!object.is_object()) return nullptr;
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

Check nonEmptyString() {
  return check([](const Json* v) { return isString(v) && !text(v).empty(); },
               "Must be a non-empty string");
}

Check featureIdText() {
  return check(
      [](const Json* v) {
        return isString(v) && !text(v).empty() && text(v).find('/') == std::string::npos &&
               text(v) != document::ORIGIN;
      },
      "Must be a non-empty string without '/', other than 'origin'");
}

Check bodyIdText() {
  return check([](const Json* v) { return isString(v) && document::parseBodyId(text(v)); },
               "Must be a body id '<feature>/body' or '<feature>/body:<n>'");
}

Check bodyColorOrNull() {
  return check(
      [](const Json* v) {
        return v != nullptr && (v->is_null() || (v->is_string() && document::isBodyColor(text(v))));
      },
      "Must be null or a color '#rrggbb' in lower case");
}

Check bodyMaterial() {
  return check(
      [](const Json* v) { return isString(v) && document::parseBodyMaterial(text(v)).has_value(); },
      "Must be a body material (plastic, aluminium, steel, brass, glass, rubber)");
}

Check string() { return check(isString, "Must be a string"); }

Check boolean() {
  return check([](const Json* v) { return v != nullptr && v->is_boolean(); }, "Must be a boolean");
}

Check jsonObject() {
  return check([](const Json* v) { return v != nullptr && document::isJsonObject(*v); },
               "Must be a plain JSON object");
}

Check wholeNumber(int min) {
  return check(
      [min](const Json* v) {
        return v != nullptr && core::isWholeNumber(*v) && core::numberOf(*v) >= min;
      },
      "Must be a whole number >= " + std::to_string(min));
}

Check object(std::vector<Field> fields) {
  return [fields = std::move(fields)](const Json* value, const std::string& path) {
    if (value == nullptr || !value->is_object()) {
      return Errors{OperationLoadError{path, "Must be an object"}};
    }
    Errors errors;
    for (const Field& f : fields) {
      const std::string fieldPath = path.empty() ? f.key : path + "." + f.key;
      for (auto& error : f.check(field(*value, f.key.c_str()), fieldPath)) {
        errors.push_back(std::move(error));
      }
    }
    return errors;
  };
}

Errors validateShape(const std::vector<Field>& fields, const Operation& op) {
  return object(fields)(&op, "");
}

}  // namespace tinycad::ops::shape
