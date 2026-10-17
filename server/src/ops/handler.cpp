#include "tinycad/ops/handler.hpp"

#include <string>
#include <utility>

#include "handlers/handlers.hpp"

namespace tinycad::ops {

std::vector<OperationLoadError> OpHandler::validate(const Operation& /*op*/) const { return {}; }

std::optional<Operation> OpHandler::merge(const Operation& /*prev*/,
                                          const Operation& /*next*/) const {
  return std::nullopt;
}

Operation OpHandler::upcast(int /*fromVersion*/, const Operation& /*raw*/) const {
  // upcastOperation calls it only when hasUpcast(), which overrides this.
  TINYCAD_ASSERT(false, "Operation '" + std::string(type()) + "' has no upcast");
  return {};
}

OpHandlerRegistry::OpHandlerRegistry(const document::FeatureSchemaRegistryReader& schemas) {
  for (auto group : {handlers::featureHandlers(schemas), handlers::studioHandlers(),
                     handlers::bodyHandlers(), handlers::documentHandlers()}) {
    for (auto& handler : group) add(std::move(handler));
  }
}

void OpHandlerRegistry::add(OpHandlerPtr handler) {
  TINYCAD_ASSERT(handler != nullptr, "OpHandlerRegistry: the handler must not be null");
  TINYCAD_ASSERT(handler->type() != "batch",
                 "'batch' is a structural operation and cannot have a handler");
  TINYCAD_ASSERT(find(handler->type()) == nullptr,
                 "Op handler '" + std::string(handler->type()) + "' is already registered");
  handlers_.push_back(std::move(handler));
}

const OpHandler* OpHandlerRegistry::find(std::string_view type) const {
  for (const OpHandlerPtr& handler : handlers_) {
    if (handler->type() == type) return handler.get();
  }
  return nullptr;
}

const OpHandler& OpHandlerRegistry::get(std::string_view type) const {
  const OpHandler* handler = find(type);
  TINYCAD_ASSERT(handler != nullptr, "Unknown op handler '" + std::string(type) + "'");
  return *handler;
}

std::vector<const OpHandler*> OpHandlerRegistry::all() const {
  std::vector<const OpHandler*> out;
  out.reserve(handlers_.size());
  for (const OpHandlerPtr& handler : handlers_) out.push_back(handler.get());
  return out;
}

}  // namespace tinycad::ops
