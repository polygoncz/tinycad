#include "tinycad/geometry/geometry.hpp"

#include <Standard_Failure.hxx>

#include <exception>
#include <string>

#include "algorithms.hpp"
#include "failure.hpp"
#include "validate.hpp"

namespace tinycad::geometry {

std::string_view codeName(ErrorCode code) {
  switch (code) {
    case ErrorCode::InvalidInput:
      return "invalid-input";
    case ErrorCode::OperationFailed:
      return "operation-failed";
    case ErrorCode::Internal:
      break;
  }
  return "internal";
}

namespace {

/**
 * Called from a catch (...): the current exception as the error of a Result. A Failure keeps
 * its code; an OCCT exception or anything else is 'internal' (as toKernelError of
 * src/kernel-occt/occt.ts).
 */
GeometryError currentError(const std::string& call) {
  try {
    throw;
  } catch (const detail::Failure& e) {
    return {e.code(), e.what()};
  } catch (const Standard_Failure& e) {
    return {ErrorCode::Internal,
            call + ": " + e.ExceptionType() + ": " + e.what()};
  } catch (const std::exception& e) {
    return {ErrorCode::Internal, call + ": " + e.what()};
  } catch (...) {
    return {ErrorCode::Internal, call + ": unknown exception"};
  }
}

}  // namespace

GeometryResult<std::vector<CurveHit>> Geometry2d::intersections(
    const std::vector<Curve2>& curves) const {
  try {
    return detail::intersectionsOf(detail::checkIntersections(curves));
  } catch (...) {
    return core::fail(currentError("curveIntersections"));
  }
}

GeometryResult<Curve2> Geometry2d::segment(const Curve2& curve, double from, double to) const {
  try {
    return detail::segmentOf(detail::checkSegment(curve, from, to));
  } catch (...) {
    return core::fail(currentError("curveSegment"));
  }
}

GeometryResult<FilletArc> Geometry2d::fillet(const Curve2& a, const Curve2& b, double radius,
                                             Vec2 near) const {
  try {
    detail::checkFillet(a, b, radius, near);
    return detail::filletOf(a, b, radius, near);
  } catch (...) {
    return core::fail(currentError("filletArc"));
  }
}

GeometryResult<std::vector<OffsetCurve>> Geometry2d::offset(const std::vector<Curve2>& chain,
                                                            bool closed, double distance) const {
  try {
    detail::checkOffset(chain, closed, distance);
    return detail::offsetOf(chain, closed, distance);
  } catch (...) {
    return core::fail(currentError("offsetCurves"));
  }
}

}  // namespace tinycad::geometry
