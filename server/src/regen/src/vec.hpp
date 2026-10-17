#pragma once

// The few 3D vector operations regen needs (internal; core has only the value types, while
// src/core/math/vec3.ts has them as a facade over gl-matrix).

#include <cmath>

#include "tinycad/core/math.hpp"

namespace tinycad::regen::vec {

using core::Vec3;

inline Vec3 add(const Vec3& a, const Vec3& b) { return {a[0] + b[0], a[1] + b[1], a[2] + b[2]}; }
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
inline Vec3 scale(const Vec3& a, double s) { return {a[0] * s, a[1] * s, a[2] * s}; }
inline double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}
inline double length(const Vec3& a) { return std::sqrt(dot(a, a)); }
/** The unit vector; the caller guarantees a non-zero length. */
inline Vec3 normalize(const Vec3& a) { return scale(a, 1.0 / length(a)); }

}  // namespace tinycad::regen::vec
