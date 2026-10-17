// Reading evaluated params and small shared steps of the builders.

#include "common/params.hpp"

#include <algorithm>
#include <limits>
#include <set>

#include "tinycad/core/result.hpp"

namespace tinycad::features {

using core::Json;

namespace {

const Json& fieldOf(const Json& params, const std::string& key) {
  TINYCAD_ASSERT(params.is_object() && params.contains(key),
                 "Evaluated params without '" + key + "'");
  return params.at(key);
}

}  // namespace

std::vector<document::EntityRef> refsOf(const Json& params, const std::string& key,
                                        document::RefKind kind) {
  const Json& raw = fieldOf(params, key);
  TINYCAD_ASSERT(raw.is_array(), "Param '" + key + "' is not an array");
  std::vector<document::EntityRef> refs;
  for (const auto& item : raw) {
    auto ref = document::readRef(kind, item);
    TINYCAD_ASSERT(ref.has_value(), "Param '" + key + "' holds a malformed reference");
    refs.push_back(std::move(*ref));
  }
  return refs;
}

document::EntityRef refOf(const Json& params, const std::string& key,
                          const std::vector<document::RefKind>& kinds) {
  auto ref = document::readRefOf(kinds, fieldOf(params, key));
  TINYCAD_ASSERT(ref.has_value(), "Param '" + key + "' is not a reference");
  return std::move(*ref);
}

core::Vec3 vec3Of(const Json& params, const std::string& key) {
  auto v = core::readVec3(fieldOf(params, key));
  TINYCAD_ASSERT(v.has_value(), "Param '" + key + "' is not a point");
  return *v;
}

double numberOf(const Json& params, const std::string& key) {
  const Json& v = fieldOf(params, key);
  TINYCAD_ASSERT(core::isFiniteNumber(v), "Param '" + key + "' is not a number");
  return core::numberOf(v);
}

std::string stringOf(const Json& params, const std::string& key) {
  const Json& v = fieldOf(params, key);
  TINYCAD_ASSERT(v.is_string(), "Param '" + key + "' is not a string");
  return v.get<std::string>();
}

bool boolOf(const Json& params, const std::string& key) {
  const Json& v = fieldOf(params, key);
  TINYCAD_ASSERT(v.is_boolean(), "Param '" + key + "' is not a boolean");
  return v.get<bool>();
}

std::vector<BodyEdges> groupByBody(const std::vector<regen::ResolvedTopo>& resolved) {
  std::vector<BodyEdges> groups;
  std::vector<std::set<int>> indices;
  for (const auto& r : resolved) {
    std::size_t g = 0;
    while (g < groups.size() && groups[g].body->id() != r.body->id()) ++g;
    if (g == groups.size()) {
      groups.push_back(BodyEdges{r.body, {}});
      indices.emplace_back();
    }
    indices[g].insert(r.indices.begin(), r.indices.end());
  }
  for (std::size_t g = 0; g < groups.size(); ++g) {
    groups[g].indices.assign(indices[g].begin(), indices[g].end());
  }
  return groups;
}

kernel::KernelResult<core::Vec3> centerOf(kernel::QueryOps& kernel,
                                          const std::vector<kernel::ShapeHandle>& shapes) {
  constexpr double inf = std::numeric_limits<double>::infinity();
  core::Vec3 min{inf, inf, inf};
  core::Vec3 max{-inf, -inf, -inf};
  for (auto shape : shapes) {
    auto box = kernel.boundingBox(shape);
    if (!box) return core::fail(box.error());
    for (std::size_t i = 0; i < 3; ++i) {
      min[i] = std::min(min[i], box->min[i]);
      max[i] = std::max(max[i], box->max[i]);
    }
  }
  return core::Vec3{(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5};
}

}  // namespace tinycad::features
