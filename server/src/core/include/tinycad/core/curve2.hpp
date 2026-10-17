#pragma once

// The 2D curve shared by geometry (M39), kernel (ProfileCurve) and sketch (Curve2).
// TypeScript has two structurally equal types (src/sketch/curve2.ts, src/kernel/profile.ts
// ProfileCurve, ADR 0017); C++ has no structural typing, so the one type lives in core and kernel
// and sketch alias it (decision N12 in docs/40-plan/Rozhodnutí nativního jádra.md).
//
// KISS (N9): one plain struct with a `kind` and a switch, not a std::variant. Only the fields of
// the kind are meaningful; the others keep their defaults. The named constructors fill the right
// ones.

#include <string>
#include <vector>

#include "tinycad/core/math.hpp"

namespace tinycad::core {

struct Curve2 {
  /** JSON `kind`: "line", "arc", "circle", "bspline". */
  enum class Kind { Line, Arc, Circle, BSpline };

  Kind kind = Kind::Line;
  /** Line and Arc: start point. */
  Vec2 from{};
  /** Line and Arc: end point. */
  Vec2 to{};
  /** Arc and Circle. */
  Vec2 center{};
  /** Arc: counter-clockwise from `from` to `to`. */
  bool ccw = true;
  /** Circle. */
  double radius = 0;
  /** BSpline: a clamped polynomial B-spline from the first pole to the last one (M29). */
  int degree = 0;
  std::vector<Vec2> poles;
  std::vector<double> knots;
  /** Id of the sketch entity the curve comes from; "" = none (same as a missing `id` in TS). */
  std::string id;

  static Curve2 line(Vec2 from, Vec2 to, std::string id = {});
  static Curve2 arc(Vec2 center, Vec2 from, Vec2 to, bool ccw, std::string id = {});
  static Curve2 circle(Vec2 center, double radius, std::string id = {});
  static Curve2 bspline(int degree, std::vector<Vec2> poles, std::vector<double> knots,
                        std::string id = {});

  /** The JSON `kind`. */
  [[nodiscard]] const char* kindName() const;

  friend bool operator==(const Curve2&, const Curve2&) = default;
};

}  // namespace tinycad::core
