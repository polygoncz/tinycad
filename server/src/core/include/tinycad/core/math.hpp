#pragma once

// Math value types shared by every area of tinycad-core; the C++ mirror of src/core/math
// (spec 02-core). Plain aggregates: copying is cheap and they never own resources.
// Units: mm and radians (spec 01 "Souřadnice a jednotky").

#include <array>
#include <vector>

namespace tinycad::core {

/** A 2D point or vector, [x, y]. */
using Vec2 = std::array<double, 2>;

/** A 3D point or vector, [x, y, z]. */
using Vec3 = std::array<double, 3>;

/**
 * A 4x4 matrix, column-major like src/core/math/mat4.ts (gl-matrix): element (row r, column c)
 * is at index c * 4 + r, so the translation is at indices 12, 13, 14.
 */
using Mat4 = std::array<double, 16>;

/**
 * Plane frame: origin, unit x axis and unit normal, mutually perpendicular; axis y = normal × xDir
 * (src/core/math/plane.ts).
 */
struct Plane {
  Vec3 origin{};
  Vec3 xDir{};
  Vec3 normal{};

  friend bool operator==(const Plane&, const Plane&) = default;
};

/** A clamped polynomial B-spline (src/core/math/bspline.ts BSplineShape). */
struct BSplineShape {
  int degree = 0;
  std::vector<Vec2> poles;
  std::vector<double> knots;

  friend bool operator==(const BSplineShape&, const BSplineShape&) = default;
};

}  // namespace tinycad::core
