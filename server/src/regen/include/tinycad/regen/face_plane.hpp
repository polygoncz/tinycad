#pragma once

// Planes of references (spec 07, spec 12 "Roviny a počátek", src/regen/face-plane.ts): the plane of
// a plane artifact or the sketch frame of a planar body face (M14, R106). Shared by
// BuildContext::resolvePlanes and planeOfRef, so a sketch builds on the plane the editor shows.

#include <optional>

#include "tinycad/core/math.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/kernel/types.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

/**
 * The frame of a sketch on a planar face: normal = the unit face normal (out of the solid),
 * origin = the projection of the world origin onto the face plane, xDir = the unit projection of
 * +X, or of +Y when |normal · X| ≥ 0.9. Orthonormal.
 */
Plane sketchPlaneOfFace(const kernel::FacePlane& face);

/**
 * The plane of one Plane or Topo reference over a finished state, without warnings (what
 * resolvePlanes gives a builder); anything unresolved, a non-planar face too → nullopt.
 */
std::optional<Plane> planeOfRef(const RegenState& state, const document::EntityRef& ref);

}  // namespace tinycad::regen
