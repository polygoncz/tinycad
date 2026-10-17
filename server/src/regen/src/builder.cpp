// The builder registry and the two feature errors every builder uses (spec 07 "Builder featury",
// src/regen/builder.ts).

#include "tinycad/regen/builder.hpp"

#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::regen {

FeatureError unresolvedReference(std::string_view param, const RefError& e) {
  return FeatureError{FeatureErrorCode::UnresolvedReference,
                      e.message,
                      {document::ParamIssue{std::string(param), "param.unresolvedRef", nullptr}}};
}

FeatureError kernelFailure(const kernel::KernelError& e) {
  std::string code;
  switch (e.code) {
    case kernel::KernelErrorCode::OperationFailed:
      code = "kernel.operationFailed";
      break;
    case kernel::KernelErrorCode::InvalidInput:
      code = "kernel.invalidInput";
      break;
    default:
      code = "kernel.internal";
      break;
  }
  return FeatureError{FeatureErrorCode::Kernel, e.message,
                      {document::ParamIssue{"", std::move(code), nullptr}}};
}

void FeatureBuilderRegistry::add(FeatureBuilderPtr builder) {
  TINYCAD_ASSERT(builder != nullptr, "FeatureBuilderRegistry: a null builder");
  TINYCAD_ASSERT(find(builder->type()) == nullptr,
                 "FeatureBuilderRegistry: duplicate feature builder '" + builder->type() + "'");
  builders_.push_back(std::move(builder));
}

const FeatureBuilder* FeatureBuilderRegistry::find(std::string_view type) const {
  for (const auto& b : builders_) {
    if (b->type() == type) return b.get();
  }
  return nullptr;
}

std::vector<const FeatureBuilder*> FeatureBuilderRegistry::all() const {
  std::vector<const FeatureBuilder*> out;
  out.reserve(builders_.size());
  for (const auto& b : builders_) out.push_back(b.get());
  return out;
}

}  // namespace tinycad::regen
