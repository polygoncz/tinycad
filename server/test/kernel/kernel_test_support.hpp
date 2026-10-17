#pragma once

// Shared fixtures and checks of the kernel tests: the C++ port of the helpers of the contract
// suite src/kernel/testing.ts (boxes off the origin, bounding box and mesh checks, profiles) and
// of the OCCT adapter tests (mesh volume, spline areas).

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <optional>
#include <ostream>
#include <stdexcept>
#include <string>
#include <vector>

#include "tinycad/kernel/mesh.hpp"
#include "tinycad/kernel/occt_kernel.hpp"

namespace tinycad::kernel {

/** Readable kernel error codes in GoogleTest messages. */
inline void PrintTo(KernelErrorCode code, std::ostream* os) { *os << kernelErrorCodeName(code); }

inline void PrintTo(SubShapeType type, std::ostream* os) {
  *os << (type == SubShapeType::Face ? "face" : type == SubShapeType::Edge ? "edge" : "vertex");
}

inline void PrintTo(const SubShapeIndex& s, std::ostream* os) {
  PrintTo(s.type, os);
  *os << ":" << s.index;
}

}  // namespace tinycad::kernel

namespace tinycad::kernel::test {

using core::Mat4;
using core::Plane;
using core::Vec2;
using core::Vec3;

inline constexpr double kTurn = 2 * std::numbers::pi;

// An asymmetric box off the origin, so that swapped axes or a lost origin show up.
inline constexpr Vec3 kOrigin{1, -2, 3};
inline constexpr Vec3 kSize{2, 3, 4};
inline constexpr Vec3 kBoxMax{3, 1, 7};
inline const BoxInput kBox{kOrigin, kSize};
/** Spec 06: the bounding box may exceed the box by at most this much in each component. */
inline constexpr double kBboxMaxOversize = 1e-6;
/** Spec 06 (M11): bounding boxes of modelling results are compared within this. */
inline constexpr double kBboxTolerance = 1e-5;
/** Mesh coordinates are float32: allow 1e-5 of the extent of the box. */
inline constexpr double kMeshTolerance = 1e-5 * 7;
/** The tolerance validateMeshData uses for unit normals. */
inline constexpr double kNormalTolerance = 1e-4;
inline constexpr MeshQuality kQuality{0.1, 0.5};

// M11: the cylinder stands on the box corner kOrigin; its axis is not unit length.
inline const CylinderInput kCylinder{kOrigin, {0, 0, 2}, 2, 4};
inline constexpr Vec3 kCylinderMin{-1, -4, 3};
inline constexpr Vec3 kCylinderMax{3, 0, 7};
/** [2, 0, 5]..[4, 2, 9]: overlaps kBox in [2, 0, 5]..[3, 1, 7]. */
inline const BoxInput kOverlapping{{2, 0, 5}, {2, 2, 4}};
/** [10, 0, 0]..[11, 1, 1]: no common point with kBox. */
inline const BoxInput kSeparate{{10, 0, 0}, {1, 1, 1}};
/** [2.5, 0.5, 6.5]..[3.5, 1.5, 7.5]: cuts the corner kBoxMax off kBox, no whole side. */
inline const BoxInput kCorner{{2.5, 0.5, 6.5}, {1, 1, 1}};

/** Handles the kernel has never issued (a fresh kernel counts from 1). */
inline const std::vector<ShapeHandle> kNeverIssued{ShapeHandle{1'000'000}, ShapeHandle{0},
                                                   ShapeHandle{~0ULL}};
inline constexpr ShapeHandle kUnknown{1'000'000};

// M12/M13 planes and profiles.
inline const Plane kPlaneXY{{0, 0, 0}, {1, 0, 0}, {0, 0, 1}};
/** XZ through the origin: x → +X, y → normal × xDir = +Z. */
inline const Plane kPlaneXZ{{0, 0, 0}, {1, 0, 0}, {0, -1, 0}};
inline const Axis kZAxis{{0, 0, 0}, {0, 0, 1}};

/** The value of a successful result; throws (a test failure) with the error otherwise. */
template <class T>
T ok(KernelResult<T> result) {
  if (!result) {
    throw std::runtime_error(std::string("kernel call failed: ") +
                             std::string(kernelErrorCodeName(result.error().code)) + ": " +
                             result.error().message);
  }
  return std::move(*result);
}

inline void ok(const KernelResult<void>& result) {
  if (!result) {
    throw std::runtime_error(std::string("kernel call failed: ") +
                             std::string(kernelErrorCodeName(result.error().code)) + ": " +
                             result.error().message);
  }
}

/** The error code of a failed result, nullopt (and a test failure) for a success. */
template <class T>
std::optional<KernelErrorCode> codeOf(const KernelResult<T>& result) {
  if (result) {
    ADD_FAILURE() << "expected the kernel call to fail";
    return std::nullopt;
  }
  return result.error().code;
}

/** The message of a failed result. */
template <class T>
std::string messageOf(const KernelResult<T>& result) {
  return result ? std::string() : result.error().message;
}

inline core::Curve2 line(Vec2 from, Vec2 to, std::string id = {}) {
  return core::Curve2::line(from, to, std::move(id));
}

inline core::Curve2 arc(Vec2 center, Vec2 from, Vec2 to, bool ccw, std::string id = {}) {
  return core::Curve2::arc(center, from, to, ccw, std::move(id));
}

inline core::Curve2 circle(Vec2 center, double radius, std::string id = {}) {
  return core::Curve2::circle(center, radius, std::move(id));
}

/** A clamped knot vector with uniform inner knots for `count` poles. */
inline std::vector<double> clampedKnots(std::size_t count, int degree) {
  const auto d = static_cast<std::size_t>(degree);
  const std::size_t inner = count - d - 1;
  std::vector<double> knots(d + 1, 0.0);
  for (std::size_t i = 0; i < inner; ++i) {
    knots.push_back(static_cast<double>(i + 1) / static_cast<double>(inner + 1));
  }
  knots.insert(knots.end(), d + 1, 1.0);
  return knots;
}

inline core::Curve2 spline(std::string id, std::vector<Vec2> poles, int degree = 3) {
  std::vector<double> knots = clampedKnots(poles.size(), degree);
  return core::Curve2::bspline(degree, std::move(poles), std::move(knots), std::move(id));
}

/** Closed polygon through the corners; the line from corner i gets the id prefix + (i + 1). */
inline ProfileLoop polygon(const std::vector<Vec2>& corners, const std::string& idPrefix = {}) {
  ProfileLoop loop;
  for (std::size_t i = 0; i < corners.size(); ++i) {
    loop.push_back(line(corners[i], corners[(i + 1) % corners.size()],
                        idPrefix.empty() ? std::string() : idPrefix + std::to_string(i + 1)));
  }
  return loop;
}

inline FaceInput faceOf(const Plane& plane, ProfileLoop outer,
                        std::vector<ProfileLoop> holes = {}) {
  return {plane, std::move(outer), std::move(holes)};
}

/** Square [0, 10]² in XY. */
inline FaceInput square10() {
  return faceOf(kPlaneXY, polygon({{0, 0}, {10, 0}, {10, 10}, {0, 10}}));
}

/** Rectangle x ∈ [5, 10], z ∈ [0, 10] in XZ: off the Z axis, a ring when revolved about it. */
inline FaceInput ringProfile(const std::string& idPrefix = {}) {
  return faceOf(kPlaneXZ, polygon({{5, 0}, {10, 0}, {10, 10}, {5, 10}}, idPrefix));
}

// --- Matrices (column-major, src/core/math/mat4.ts) -------------------------------------------

inline Mat4 identity() { return {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}; }

inline Mat4 translation(const Vec3& t) {
  Mat4 m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/** A matrix written by rows. */
inline Mat4 fromRows(const std::array<double, 16>& rows) {
  Mat4 m{};
  for (std::size_t r = 0; r < 4; ++r) {
    for (std::size_t c = 0; c < 4; ++c) m[c * 4 + r] = rows[r * 4 + c];
  }
  return m;
}

/** Rotation by `angle` about the unit-normalized `axis` through the origin (Rodrigues). */
inline Mat4 rotationAxisAngle(const Vec3& axis, double angle) {
  const double len = std::hypot(axis[0], axis[1], axis[2]);
  const double x = axis[0] / len;
  const double y = axis[1] / len;
  const double z = axis[2] / len;
  const double c = std::cos(angle);
  const double s = std::sin(angle);
  const double t = 1 - c;
  return fromRows({t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,  //
                   t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,  //
                   t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,  //
                   0, 0, 0, 1});
}

inline Mat4 multiply(const Mat4& a, const Mat4& b) {
  Mat4 m{};
  for (std::size_t r = 0; r < 4; ++r) {
    for (std::size_t c = 0; c < 4; ++c) {
      double sum = 0;
      for (std::size_t k = 0; k < 4; ++k) sum += a[k * 4 + r] * b[c * 4 + k];
      m[c * 4 + r] = sum;
    }
  }
  return m;
}

// --- Checks -----------------------------------------------------------------------------------

inline void expectVecClose(const Vec3& actual, const Vec3& expected, double tolerance,
                           const std::string& what) {
  for (std::size_t k = 0; k < 3; ++k) {
    EXPECT_NEAR(actual[k], expected[k], tolerance) << what << " axis " << k;
  }
}

/** Spec 06: the box encloses [min, max], larger by at most kBboxMaxOversize per component. */
inline void expectEnclosesBox(const BoundingBox& actual, const Vec3& min, const Vec3& max,
                              const std::string& what = "bounding box") {
  for (std::size_t k = 0; k < 3; ++k) {
    EXPECT_LE(actual.min[k], min[k]) << what << " axis " << k;
    EXPECT_GE(actual.max[k], max[k]) << what << " axis " << k;
    EXPECT_LE(min[k] - actual.min[k], kBboxMaxOversize) << what << " axis " << k;
    EXPECT_LE(actual.max[k] - max[k], kBboxMaxOversize) << what << " axis " << k;
  }
}

inline void expectBoxClose(const BoundingBox& actual, const Vec3& min, const Vec3& max,
                           const std::string& what = "bounding box") {
  expectVecClose(actual.min, min, kBboxTolerance, "min of " + what);
  expectVecClose(actual.max, max, kBboxTolerance, "max of " + what);
}

inline Vec3 pointAt(const std::vector<float>& values, std::size_t i) {
  return {values[3 * i], values[3 * i + 1], values[3 * i + 2]};
}

/** validateMeshData passes and every vertex and edge point lies in [min, max] (float32). */
inline void expectValidMeshIn(const MeshData& mesh, const Vec3& min, const Vec3& max,
                              const std::string& what) {
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{}) << what;
  double extent = 1;
  for (std::size_t k = 0; k < 3; ++k)
    extent = std::max({extent, std::abs(min[k]), std::abs(max[k])});
  const double tolerance = 1e-5 * extent;
  for (const std::vector<float>* list : {&mesh.positions, &mesh.edgePositions}) {
    for (std::size_t i = 0; i < list->size() / 3; ++i) {
      const Vec3 p = pointAt(*list, i);
      for (std::size_t k = 0; k < 3; ++k) {
        if (!(p[k] >= min[k] - tolerance && p[k] <= max[k] + tolerance)) {
          ADD_FAILURE() << what << ": point " << i << " outside the bounding box in axis " << k;
          return;
        }
      }
    }
  }
}

inline std::size_t faceCount(const MeshData& mesh) { return mesh.faceRanges.size() / 3; }

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
inline double volume(const MeshData& mesh) {
  double sum = 0;
  for (std::size_t t = 0; t < mesh.indices.size() / 3; ++t) {
    const Vec3 a = pointAt(mesh.positions, mesh.indices[3 * t]);
    const Vec3 b = pointAt(mesh.positions, mesh.indices[3 * t + 1]);
    const Vec3 c = pointAt(mesh.positions, mesh.indices[3 * t + 2]);
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) +
           a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

inline void expectWithinPercent(double actual, double expected, double percent) {
  EXPECT_LE(std::abs(actual - expected) / std::abs(expected), percent / 100)
      << actual << " vs " << expected;
}

inline void expectRelativelyClose(double actual, double expected, double tolerance) {
  EXPECT_LE(std::abs(actual - expected), tolerance * std::abs(expected))
      << actual << " vs " << expected;
}

/** The only index of a role; a test failure (and -1) unless there is exactly one. */
inline int roleIndex(const std::optional<Roles>& roles, const std::string& key) {
  if (!roles || !roles->contains(key) || roles->at(key).size() != 1) {
    ADD_FAILURE() << "role " << key << " has not exactly one sub-shape";
    return -1;
  }
  return roles->at(key).front().index;
}

/** The sorted keys of the roles. */
inline std::vector<std::string> roleKeys(const std::optional<Roles>& roles) {
  std::vector<std::string> keys;
  if (roles) {
    for (const auto& [key, subs] : *roles) keys.push_back(key);
  }
  return keys;
}

// --- Splines (bspline.ts of core, for the areas of the tests) ----------------------------------

/** The point of a clamped B-spline at u (de Boor). */
inline Vec2 splinePoint(const core::Curve2& c, double u) {
  const auto p = static_cast<std::size_t>(c.degree);
  const std::vector<double>& t = c.knots;
  std::size_t k = p;
  while (k + 1 < c.poles.size() && u >= t[k + 1]) ++k;
  std::vector<Vec2> d(c.poles.begin() + static_cast<std::ptrdiff_t>(k - p),
                      c.poles.begin() + static_cast<std::ptrdiff_t>(k + 1));
  for (std::size_t r = 1; r <= p; ++r) {
    for (std::size_t j = p; j >= r; --j) {
      const std::size_t i = j + k - p;
      const double denom = t[i + p - r + 1] - t[i];
      const double alpha = denom == 0 ? 0 : (u - t[i]) / denom;
      d[j] = {(1 - alpha) * d[j - 1][0] + alpha * d[j][0],
              (1 - alpha) * d[j - 1][1] + alpha * d[j][1]};
    }
  }
  return d[p];
}

/** Dense points of a spline from its first to its last pole (`perSpan` per knot span). */
inline std::vector<Vec2> splinePoints(const core::Curve2& c, int perSpan = 4000) {
  std::vector<Vec2> points;
  const auto p = static_cast<std::size_t>(c.degree);
  for (std::size_t s = p; s + 1 < c.knots.size() - p; ++s) {
    const double a = c.knots[s];
    const double b = c.knots[s + 1];
    if (b <= a) continue;
    for (int i = 0; i < perSpan; ++i) points.push_back(splinePoint(c, a + (b - a) * i / perSpan));
  }
  points.push_back(c.poles.back());
  return points;
}

/** Signed area of a closed polygon (shoelace), positive counter-clockwise. */
inline double polygonArea(const std::vector<Vec2>& points) {
  double twice = 0;
  for (std::size_t i = 0; i < points.size(); ++i) {
    const Vec2& p = points[i];
    const Vec2& q = points[(i + 1) % points.size()];
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return twice / 2;
}

/** A polygon part for areaWith: a corner point or a spline. */
struct AreaPart {
  AreaPart(Vec2 p) : point(p) {}  // NOLINT(google-explicit-constructor): list initialisation
  AreaPart(const core::Curve2& c) : spline(c) {}  // NOLINT(google-explicit-constructor)
  std::optional<Vec2> point;
  std::optional<core::Curve2> spline;
};

/** Area of a closed polygon of points and splines, the splines densely sampled (areaWith). */
inline double areaWith(const std::vector<AreaPart>& parts) {
  std::vector<Vec2> points;
  for (const AreaPart& part : parts) {
    if (part.point) {
      points.push_back(*part.point);
    } else {
      std::vector<Vec2> sampled = splinePoints(*part.spline);
      points.insert(points.end(), sampled.begin(), sampled.end() - 1);
    }
  }
  return polygonArea(points);
}

}  // namespace tinycad::kernel::test
