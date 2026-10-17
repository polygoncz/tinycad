#include "tinycad/kernel/profile.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>

#include "tinycad/occt2d/curve_checks.hpp"

// Port of the checks of src/kernel/profile.ts: validateFaceInput and parseProfileRegionsInput.
// One curve is checked by occt2d::readCurve, shared with tinycad_geometry (decision N77).

namespace tinycad::kernel {

namespace {

using core::Curve2;
using occt2d::CurveRead;
using occt2d::CurveRules;
using occt2d::endOf;
using occt2d::Kind;
using occt2d::readCurve;
using occt2d::samePoint;
using occt2d::startOf;

/** Spec 06: tolerance of plane.isOrthonormal for the face plane. */
constexpr double kOrthonormalTolerance = 1e-9;

constexpr CurveRules kFaceCurve{false, false};
constexpr CurveRules kRegionCurve{true, true};

bool finite(const core::Vec3& v) {
  return std::isfinite(v[0]) && std::isfinite(v[1]) && std::isfinite(v[2]);
}

double length(const core::Vec3& v) { return std::hypot(v[0], v[1], v[2]); }

double dot(const core::Vec3& a, const core::Vec3& b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

std::string at(const std::string& name, std::size_t i) {
  return name + "[" + std::to_string(i) + "]";
}

/** A loop: a single circle, or line/arc/bspline curves joined end to start, closed. */
void readLoop(const ProfileLoop& loop, const std::string& path, std::vector<std::string>& errors) {
  if (loop.empty()) {
    errors.push_back(path + " must not be empty");
    return;
  }
  bool allOk = true;
  for (std::size_t i = 0; i < loop.size(); ++i) {
    if (readCurve(loop[i], at(path, i), errors, kFaceCurve) != CurveRead::Ok) allOk = false;
  }
  if (!allOk) return;
  const bool hasCircle =
      std::any_of(loop.begin(), loop.end(), [](const Curve2& c) { return c.kind == Kind::Circle; });
  if (hasCircle) {
    if (loop.size() != 1) errors.push_back(path + ": a circle must be the only curve of its loop");
    return;
  }
  for (std::size_t i = 0; i < loop.size(); ++i) {
    if (!samePoint(endOf(loop[i]), startOf(loop[(i + 1) % loop.size()]))) {
      errors.push_back(at(path, i) +
                       ": its end must lie on the start of the next curve (closed loop)");
      return;
    }
  }
}

}  // namespace

std::vector<std::string> validateFaceInput(const FaceInput& input) {
  std::vector<std::string> errors;
  const core::Plane& plane = input.plane;
  if (!finite(plane.origin) || !finite(plane.xDir) || !finite(plane.normal)) {
    errors.emplace_back("plane: origin, xDir and normal must be 3 finite numbers each");
  } else if (!(std::abs(length(plane.xDir) - 1) <= kOrthonormalTolerance &&
               std::abs(length(plane.normal) - 1) <= kOrthonormalTolerance &&
               std::abs(dot(plane.xDir, plane.normal)) <= kOrthonormalTolerance)) {
    errors.emplace_back("plane: xDir and normal must be unit and perpendicular");
  }
  readLoop(input.outer, "outer", errors);
  for (std::size_t i = 0; i < input.holes.size(); ++i)
    readLoop(input.holes[i], at("holes", i), errors);
  return errors;
}

core::Result<std::vector<ProfileCurve>, std::vector<std::string>> parseProfileRegionsInput(
    const std::vector<ProfileCurve>& curves) {
  std::vector<std::string> errors;
  std::vector<ProfileCurve> checked;
  std::set<std::string> seen;
  for (std::size_t i = 0; i < curves.size(); ++i) {
    const std::string path = at("curves", i);
    const Curve2& curve = curves[i];
    // Unique among all curves, the skipped ones of zero length too.
    if (!curve.id.empty()) {
      if (seen.contains(curve.id))
        errors.push_back(path + ": id " + curve.id + " is used by another curve");
      seen.insert(curve.id);
    }
    if (readCurve(curve, path, errors, kRegionCurve) == CurveRead::Ok) checked.push_back(curve);
  }
  if (!errors.empty()) return core::fail(std::move(errors));
  return checked;
}

}  // namespace tinycad::kernel
