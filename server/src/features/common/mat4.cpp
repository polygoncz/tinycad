// 4×4 matrices for the builders, the formulas of gl-matrix (mat4.fromTranslation, fromRotation,
// multiply) that src/core/math/mat4.ts wraps.

#include "common/mat4.hpp"

#include <cmath>
#include <cstddef>

namespace tinycad::features::math {

Vec3 add(const Vec3& a, const Vec3& b) { return {a[0] + b[0], a[1] + b[1], a[2] + b[2]}; }
Vec3 sub(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
Vec3 scale(const Vec3& a, double s) { return {a[0] * s, a[1] * s, a[2] * s}; }
double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

Mat4 identity() { return {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}; }

Mat4 translation(const Vec3& t) {
  Mat4 m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

Mat4 rotationAxisAngle(const Vec3& axis, double angle) {
  const double len = std::sqrt(dot(axis, axis));
  const double x = axis[0] / len;
  const double y = axis[1] / len;
  const double z = axis[2] / len;
  const double s = std::sin(angle);
  const double c = std::cos(angle);
  const double t = 1 - c;
  // Column-major: each line is one column of the matrix.
  // clang-format off
  return {x * x * t + c,     y * x * t + z * s, z * x * t - y * s, 0,
          x * y * t - z * s, y * y * t + c,     z * y * t + x * s, 0,
          x * z * t + y * s, y * z * t - x * s, z * z * t + c,     0,
          0,                 0,                 0,                 1};
  // clang-format on
}

Mat4 multiply(const Mat4& a, const Mat4& b) {
  Mat4 out{};
  for (std::size_t c = 0; c < 4; ++c) {
    for (std::size_t r = 0; r < 4; ++r) {
      double sum = 0;
      for (std::size_t k = 0; k < 4; ++k) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

Vec3 transformPoint(const Mat4& m, const Vec3& p) {
  const double w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const double d = w == 0 ? 1 : w;
  return {(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / d,
          (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / d,
          (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / d};
}

}  // namespace tinycad::features::math
