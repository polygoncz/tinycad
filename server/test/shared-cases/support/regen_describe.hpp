#pragma once

// The description of a regeneration result shared by the regen case runner and the regen property
// test (spec 13 "Druhy případů › regen"; port of describeResult in
// test/integration/shared-cases/regen.test.ts): statuses in feature order, bodies by id with
// faces and edges by their names and geometric signatures (never by sub-shape indices, Q108), the
// volume from a fine mesh, the sketches and the anchors. The orderings the domain does not define
// follow support/sort.ts (total orders, so std::sort needs no stability).

#include <string>

#include "tinycad/core/json.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/regenerator.hpp"

namespace tinycad::testing {

/** The issue order of schema.validate and of an error status (compareIssues of support/sort.ts). */
bool issueBefore(const document::ParamIssue& a, const document::ParamIssue& b);

/** A number for sorting only: rounded to 6 decimals, half away from zero (sortKey). */
double sortKey(double x);

/** { kind } with code and sorted issues for an error; never the message (spec 13). */
core::Json describeStatus(const regen::FeatureStatus& status);

/** { bodies, sketches } of a state, each sorted by id; the kernel answers the geometry. */
core::Json describeState(kernel::GeometryKernel& kernel, const regen::RegenState& state);

/** { statuses, bodies, sketches, anchors } of a result. */
core::Json describeResult(kernel::GeometryKernel& kernel, const regen::RegenResult& result);

}  // namespace tinycad::testing
