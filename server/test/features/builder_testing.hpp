#pragma once

// Helpers of the builder tests (the builder parts of test/unit/features/<name>/<name>.test.ts):
// run one builder on a state over OcctKernel with the counting decorator of regen (N45).

#include <gtest/gtest.h>

#include <optional>
#include <string>

#include "regen/testing.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/regen/builder.hpp"

namespace tinycad::features::test {

using core::Json;
using regen::test::CountingKernel;
using regen::test::fid;

/** The outcome of one build: the result and the warnings of its context. */
struct Built {
  regen::BuildResult result;
  std::optional<std::string> warnings;
  regen::OwnedHandles owned;

  [[nodiscard]] const regen::BuildOutput& ok() const {
    if (!result) throw std::runtime_error("build failed: " + result.error().message);
    return *result;
  }
  [[nodiscard]] const regen::FeatureError& error() const {
    if (result) throw std::runtime_error("build succeeded");
    return result.error();
  }
};

/** The built-in builder of `type`. */
inline const regen::FeatureBuilder& builderOf(const std::string& type) {
  static const regen::FeatureBuilderRegistry registry = [] {
    regen::FeatureBuilderRegistry r;
    registerBuiltInBuilders(r);
    return r;
  }();
  const auto* builder = registry.find(type);
  if (builder == nullptr) throw std::runtime_error("no builder " + type);
  return *builder;
}

/** Builds the feature `id` of `type` with (already valid) params over `state`. */
inline Built build(CountingKernel& kernel, const std::string& type, const std::string& id,
                   const Json& params, regen::StatePtr state = regen::RegenState::empty()) {
  document::FeatureInstance feature;
  feature.id = fid(id);
  feature.type = type;
  feature.name = id;
  feature.params = std::make_shared<const Json>(params);
  regen::OwnedHandles owned;
  regen::BuildContext ctx(kernel, owned, state);
  auto result = builderOf(type).build(regen::BuildInput{feature, params, state}, ctx);
  return Built{std::move(result), ctx.warnings(), std::move(owned)};
}

inline Json boxParams(core::Vec3 origin, core::Vec3 size) {
  return {{"origin", {origin[0], origin[1], origin[2]}},
          {"width", size[0]},
          {"depth", size[1]},
          {"height", size[2]}};
}

/** The state after a box feature `id` (named by its roles). */
inline regen::StatePtr withBox(CountingKernel& kernel, const std::string& id, core::Vec3 origin,
                               core::Vec3 size,
                               regen::StatePtr state = regen::RegenState::empty()) {
  return build(kernel, "box", id, boxParams(origin, size), std::move(state)).ok().state;
}

inline Json bodyRef(const std::string& origin) {
  return {{"kind", "body"}, {"body", origin + "/body"}};
}

inline Json topoRef(const std::string& origin, const std::string& name) {
  return {{"kind", "topo"}, {"body", origin + "/body"}, {"name", name}};
}

/** The body with the id; throws when the state has none. */
inline regen::BodyPtr bodyAt(const regen::RegenState& state, const std::string& id) {
  const auto a = state.find(id);
  if (a == nullptr || a->kind() != regen::ArtifactKind::Body) {
    throw std::runtime_error("no body " + id);
  }
  return std::static_pointer_cast<const regen::Body>(a);
}

inline std::vector<std::string> idsOf(const regen::RegenState& state) {
  std::vector<std::string> ids;
  for (const auto& a : state.artifacts()) ids.push_back(a->id());
  return ids;
}

/** The ids of the origin artifacts followed by `rest`. */
inline std::vector<std::string> withOrigin(std::vector<std::string> rest) {
  std::vector<std::string> ids = idsOf(*regen::RegenState::empty());
  ids.insert(ids.end(), rest.begin(), rest.end());
  return ids;
}

inline void expectVec(const core::Vec3& actual, const core::Vec3& expected, double tol = 1e-6) {
  for (std::size_t i = 0; i < 3; ++i) EXPECT_NEAR(actual[i], expected[i], tol) << "component " << i;
}

inline kernel::BoundingBox bboxOf(CountingKernel& kernel, const regen::Body& body) {
  auto box = kernel.boundingBox(body.shape());
  if (!box) throw std::runtime_error(box.error().message);
  return *box;
}

inline std::vector<std::string> faceNames(const regen::NameTable& names) {
  std::vector<std::string> out;
  for (const auto& [name, indices] : names.faceEntries()) out.push_back(name.str());
  return out;
}

}  // namespace tinycad::features::test
