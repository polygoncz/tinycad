#pragma once

// Resolving topological and plane references over a state (internal to regen; the shared half of
// BuildContext::resolvePlanes/resolveTopo and planeOfRef, src/regen/face-plane.ts).

#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen::detail {

/** A body of a state and the indices of its faces or edges with a name (≥ 1, ascending). */
struct NamedTopo {
  BodyPtr body;
  std::vector<int> indices;
};

/** The body `id` of `state` and its faces or edges named `name`, or why not. */
core::Result<NamedTopo, std::string> resolveNamed(const RegenState& state, const BodyId& id,
                                                  const TopoName& name, TopoKind kind);

/** A resolved plane and the number of faces the name matched (1 for a plane artifact). */
struct PlaneOfRef {
  Plane plane;
  std::size_t matches = 1;
};

/** The plane of a Plane or Topo reference in `state`, or why it does not resolve. */
core::Result<PlaneOfRef, std::string> resolvePlaneRef(const RegenState& state,
                                                      const document::EntityRef& ref);

}  // namespace tinycad::regen::detail
