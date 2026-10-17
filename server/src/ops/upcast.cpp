#include "tinycad/ops/upcast.hpp"

#include <cstddef>
#include <string>
#include <utility>

namespace tinycad::ops {

namespace {

using Result = core::Result<Operation, OperationLoadError>;

Result fail(std::string path, std::string message) {
  return core::fail(OperationLoadError{std::move(path), std::move(message)});
}

std::string number(double v) { return core::numberJson(v).dump(); }

/** The payload checks of the handler; the first problem wins. */
Result validated(const OpHandler& handler, Operation op) {
  const auto errors = handler.validate(op);
  if (!errors.empty()) return core::fail(errors.front());
  return op;
}

Result upcastBatch(const OpHandlerRegistry& handlers, const Json& raw, double v) {
  const int version = opVersion("batch");
  if (v != version) {
    return fail("v", "Batch has version " + number(v) + ", newer than supported " +
                         std::to_string(version));
  }
  const auto rawOps = raw.find("ops");
  if (rawOps == raw.end() || !rawOps->is_array()) return fail("ops", "Must be an array");
  Json ops = Json::array();
  for (std::size_t i = 0; i < rawOps->size(); ++i) {
    auto result = upcastOperation(handlers, (*rawOps)[i]);
    if (!result) {
      const std::string prefix = "ops[" + std::to_string(i) + "]";
      const std::string& path = result.error().path;
      return fail(path.empty() ? prefix : prefix + "." + path, result.error().message);
    }
    ops.push_back(std::move(*result));
  }
  return Json{{"type", "batch"}, {"v", version}, {"ops", std::move(ops)}};
}

}  // namespace

Result upcastOperation(const OpHandlerRegistry& handlers, const Json& raw) {
  if (!raw.is_object()) return fail("", "Must be an object");
  const auto type = raw.find("type");
  if (type == raw.end() || !type->is_string()) return fail("type", "Must be a string");
  const auto rawV = raw.find("v");
  if (rawV == raw.end() || !core::isWholeNumber(*rawV) || core::numberOf(*rawV) < 1) {
    return fail("v", "Must be a whole number >= 1");
  }
  const double v = core::numberOf(*rawV);
  const std::string& name = type->get_ref<const std::string&>();

  if (name == "batch") return upcastBatch(handlers, raw, v);

  const OpHandler* handler = handlers.find(name);
  if (handler == nullptr) return fail("type", "Unknown operation type '" + name + "'");
  if (v > handler->version()) {
    return fail("v", "Operation '" + name + "' has version " + number(v) +
                         ", newer than supported " + std::to_string(handler->version()));
  }
  if (v == handler->version()) return validated(*handler, raw);
  if (!handler->hasUpcast()) {
    return fail("v", "Operation '" + name + "' version " + number(v) + " cannot be migrated");
  }
  Operation upcasted = handler->upcast(static_cast<int>(v), raw);
  const auto upV = upcasted.find("v");
  TINYCAD_ASSERT(upV != upcasted.end() && core::isFiniteNumber(*upV) &&
                     core::numberOf(*upV) == handler->version(),
                 "Upcast of '" + name + "' returned another version than " +
                     std::to_string(handler->version()));
  return validated(*handler, std::move(upcasted));
}

}  // namespace tinycad::ops
