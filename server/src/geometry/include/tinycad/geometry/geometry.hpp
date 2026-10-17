#pragma once

// The 2D geometry of the sketcher over OCCT (spec 14 "GeometryService"; a port of
// curveIntersections, curveSegment, filletArc and offsetCurves of src/kernel-occt, which the C++
// GeometryKernel does not have, decision N15). Each call checks its input as the TypeScript
// kernel does (src/kernel/profile.ts) and returns a Result: an expected failure is a value
// (decision N10), with the KernelErrorCode of spec 06 that the shared cases pin.

#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::geometry {

using core::Curve2;
using core::Vec2;

/** KernelErrorCode of spec 06 without 'unknown-handle' (the 2D geometry has no handles). */
enum class ErrorCode {
  /** The input breaks the contract of the call. */
  InvalidInput,
  /** A valid input OCCT cannot process (no fillet of that radius, an impossible offset). */
  OperationFailed,
  /** Anything unexpected: an OCCT exception, a bug. */
  Internal,
};

/** "invalid-input", "operation-failed", "internal" (the TS codes). */
std::string_view codeName(ErrorCode code);

struct GeometryError {
  ErrorCode code = ErrorCode::Internal;
  /** Technical text for logs; never compared by tests. */
  std::string message;
};

template <class T>
using GeometryResult = core::Result<T, GeometryError>;

/**
 * A common point of the curves `a` and `b`; a == b is a spline meeting itself (ta < tb). `ta`
 * and `tb` are the parameters t of spec 12: a line [0, 1] from `from` to `to`; an arc the angle
 * from `from` in its direction; a circle the angle atan2(p - center) in [0, 2π); a spline its
 * knot parameter.
 */
struct CurveHit {
  std::string a;
  std::string b;
  Vec2 point{};
  double ta = 0;
  double tb = 0;
  /** An end of a piece the two curves share. */
  bool overlap = false;
};

/** The fillet center and the touching points with their t (on a line also outside [0, 1]). */
struct FilletArc {
  Vec2 center{};
  Vec2 pointA{};
  Vec2 pointB{};
  double ta = 0;
  double tb = 0;
};

/** A curve of an offset (its `id` empty): `source` is the id of the input curve, "" for a join. */
struct OffsetCurve {
  Curve2 curve;
  std::string source;
};

/** The four calls of the 2D sketch geometry. Holds no state; one instance may serve all threads. */
class Geometry2d {
 public:
  /**
   * Every common point of each pair of curves and of each spline with itself, ordered by a, b
   * (the order of the input) and ta. Every id is required and unique; curves of zero length are
   * left out.
   */
  [[nodiscard]] GeometryResult<std::vector<CurveHit>> intersections(
      const std::vector<Curve2>& curves) const;

  /**
   * The piece of a curve between the parameters from < to (spec 12), of the same kind and
   * direction; a circle gives a counter-clockwise arc. The id of the input stays.
   */
  [[nodiscard]] GeometryResult<Curve2> segment(const Curve2& curve, double from, double to) const;

  /** The fillet center of a radius between two lines or arcs, nearest to `near`. */
  [[nodiscard]] GeometryResult<FilletArc> fillet(const Curve2& a, const Curve2& b, double radius,
                                                 Vec2 near) const;

  /**
   * The offset of a joined chain (closed: > 0 outwards; open: > 0 to the right of the direction
   * of travel), along the chain, a closed one starting with the offset of its first curve.
   */
  [[nodiscard]] GeometryResult<std::vector<OffsetCurve>> offset(const std::vector<Curve2>& chain,
                                                                bool closed,
                                                                double distance) const;
};

}  // namespace tinycad::geometry
