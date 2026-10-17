#pragma once

// 4×4 matrices and 3D vectors for the builders (internal to tinycad_feature_builders): column-major
// like src/core/math/mat4.ts (gl-matrix), element (row r, column c) at index c * 4 + r. core has
// only the value types; should anyone outside the builders need these, they move to core.

#include "tinycad/core/math.hpp"

namespace tinycad::features::math {

using core::Mat4;
using core::Vec3;

Vec3 add(const Vec3& a, const Vec3& b);
Vec3 sub(const Vec3& a, const Vec3& b);
Vec3 scale(const Vec3& a, double s);
double dot(const Vec3& a, const Vec3& b);

Mat4 identity();
Mat4 translation(const Vec3& t);
/** Right-handed rotation by `angle` radians about `axis` (normalized here; non-zero). */
Mat4 rotationAxisAngle(const Vec3& axis, double angle);
/** a · b: the result applies b first, then a. */
Mat4 multiply(const Mat4& a, const Mat4& b);
/** The point transformed by an affine matrix (w = 1). */
Vec3 transformPoint(const Mat4& m, const Vec3& p);

}  // namespace tinycad::features::math
