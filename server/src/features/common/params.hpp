#pragma once

// Reading evaluated params and small shared steps of the builders (internal to
// tinycad_feature_builders). Params reach a builder only after schema.validate accepted them
// (evaluateParams), so a value of the wrong shape here is a bug of the Regenerator and throws
// core::AssertionError.

#include <string>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

/** The references of the array param `key`, each of `kind`. */
std::vector<document::EntityRef> refsOf(const core::Json& params, const std::string& key,
                                        document::RefKind kind);
/** The first of `kinds` that reads the single reference param `key`. */
document::EntityRef refOf(const core::Json& params, const std::string& key,
                          const std::vector<document::RefKind>& kinds);
core::Vec3 vec3Of(const core::Json& params, const std::string& key);
double numberOf(const core::Json& params, const std::string& key);
std::string stringOf(const core::Json& params, const std::string& key);
bool boolOf(const core::Json& params, const std::string& key);

/** A body and the edge indices of it, joined from several references and sorted ascending. */
struct BodyEdges {
  regen::BodyPtr body;
  std::vector<int> indices;
};

/**
 * Resolved edges grouped by body in the order of the first reference of each body; the indices
 * of a body joined (several names may share an edge) and sorted (fillet, chamfer: R105).
 */
std::vector<BodyEdges> groupByBody(const std::vector<regen::ResolvedTopo>& resolved);

/** The center of the joined bounding box of the shapes (at least one); a kernel error passes. */
kernel::KernelResult<core::Vec3> centerOf(kernel::QueryOps& kernel,
                                          const std::vector<kernel::ShapeHandle>& shapes);

}  // namespace tinycad::features
