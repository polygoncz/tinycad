// validateFaceInput and parseProfileRegionsInput (port of test/unit/kernel/profile.test.ts). The
// cases about input outside the types (null, a string for a number, a missing field) have no C++
// counterpart: the types guarantee the shape.

#include <gtest/gtest.h>

#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using core::Curve2;
using core::Vec2;
using test::arc;
using test::circle;
using test::faceOf;
using test::kPlaneXY;
using test::line;
using test::polygon;

const std::vector<std::string> kNone;
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInf = std::numeric_limits<double>::infinity();

const ProfileLoop kSquare = polygon({{0, 0}, {4, 0}, {4, 4}, {0, 4}});
const ProfileLoop kHole{circle({2, 2}, 1)};

ProfileLoop dLoop(bool ccw) { return {line({0, -1}, {0, 1}), arc({0, 0}, {0, 1}, {0, -1}, ccw)}; }

/** Quadratic spline from (4, 3) over (2, 5) to (0, 3): the top of splineLoop. */
Curve2 aSpline() { return Curve2::bspline(2, {{4, 3}, {2, 5}, {0, 3}}, {0, 0, 0, 1, 1, 1}); }

/** A rectangle [0, 4]×[0, 3] whose top side is `spline`. */
ProfileLoop splineLoop(const Curve2& spline = aSpline()) {
  return {line({0, 0}, {4, 0}), line({4, 0}, {4, 3}), spline, line({0, 3}, {0, 0})};
}

/** A cubic spline side from (4, 3) to (0, 3) with 7 poles and the given knots. */
Curve2 cubicSide(std::vector<double> knots) {
  return Curve2::bspline(3, {{4, 3}, {3.5, 4}, {3, 2}, {2, 4}, {1, 2}, {0.5, 4}, {0, 3}},
                         std::move(knots));
}

FaceInput face(ProfileLoop outer = kSquare, std::vector<ProfileLoop> holes = {},
               const core::Plane& plane = kPlaneXY) {
  return faceOf(plane, std::move(outer), std::move(holes));
}

std::string joined(const std::vector<std::string>& messages) {
  std::string text;
  for (const std::string& m : messages) text += m + "\n";
  return text;
}

TEST(ValidateFaceInput, ValidInputs) {
  const double s = std::numbers::sqrt2 / 2;
  const std::vector<std::pair<std::string, FaceInput>> cases{
      {"a square", face()},
      {"a square with a circular hole", face(kSquare, {kHole})},
      {"a square with two holes",
       face(kSquare, {kHole, polygon({{0.2, 0.2}, {0.8, 0.2}, {0.8, 0.8}})})},
      {"a single circle", face({circle({1, 2}, 0.5)})},
      {"a D, ccw", face(dLoop(true))},
      {"a D, clockwise", face(dLoop(false))},
      {"a loop in reverse orientation", face(polygon({{0, 0}, {0, 4}, {4, 4}, {4, 0}}))},
      {"a gap within 1e-7",
       face({line({0, 0}, {1, 0}), line({1, 5e-8}, {0, 1}), line({0, 1}, {0, 0})})},
      {"a gap within 1e-7 · |coordinate| far from the origin",
       face({line({1e5, 0}, {1e5 + 1, 0}), line({1e5 + 1 + 5e-3, 0}, {1e5, 1}),
             line({1e5, 1}, {1e5, 0})})},
      {"a plane off the origin, not axis-aligned",
       face(kSquare, {}, {{1, 2, 3}, {s, s, 0}, {0, 0, 1}})},
      {"a rectangle with a spline side", face(splineLoop())},
      {"a cubic spline side with an interior knot",
       face(splineLoop(Curve2::bspline(3, {{4, 3}, {3, 4}, {2, 2}, {1, 4}, {0, 3}},
                                       {0, 0, 0, 0, 0.4, 1, 1, 1, 1})))},
      {"a closed spline alone",
       face({Curve2::bspline(2, {{0, 0}, {4, 0}, {4, 4}, {0, 0}}, {0, 0, 0, 0.5, 1, 1, 1})})},
      {"a spline hole", face(polygon({{-1, -1}, {5, -1}, {5, 6}, {-1, 6}}), {splineLoop()})},
      {"knots clamped on [2, 7] with a double interior knot",
       face(splineLoop(cubicSide({2, 2, 2, 2, 3, 3, 5, 7, 7, 7, 7})))},
      {"an interior knot repeated degree times",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1})))},
  };
  for (const auto& [name, input] : cases) EXPECT_EQ(validateFaceInput(input), kNone) << name;
}

TEST(ValidateFaceInput, InvalidInputs) {
  const double s = std::numbers::sqrt2 / 2;
  Curve2 degree0 = aSpline();
  degree0.degree = 0;
  Curve2 fewPoles = Curve2::bspline(2, {{4, 3}, {0, 3}}, {0, 0, 0, 1, 1});
  Curve2 poleInf = aSpline();
  poleInf.poles[1] = {2, kInf};
  Curve2 shortKnots = aSpline();
  shortKnots.knots = {0, 0, 0, 1, 1};
  Curve2 knotNaN = aSpline();
  knotNaN.knots = {0, 0, 0, kNaN, 1, 1};
  Curve2 decreasing = aSpline();
  decreasing.knots = {0, 0, 0, 1, 0.5, 1};
  Curve2 offStart = aSpline();
  offStart.poles[0] = {4, 3.1};
  Curve2 offEnd = aSpline();
  offEnd.poles[2] = {0.1, 3};
  std::vector<Vec2> poles26;
  for (int i = 0; i <= 26; ++i)
    poles26.push_back({4 - 4.0 * i / 26, i == 0 || i == 26 ? 3.0 : 4.0});
  std::vector<double> knots26(27, 0.0);
  knots26.insert(knots26.end(), 27, 1.0);
  const Curve2 degree26 = Curve2::bspline(26, poles26, knots26);
  const Curve2 repeatedTooOften =
      Curve2::bspline(3, {{4, 3}, {3.5, 4}, {3, 2}, {2, 4}, {1.5, 2}, {1, 2}, {0.5, 4}, {0, 3}},
                      {0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1});

  const std::vector<std::pair<std::string, FaceInput>> cases{
      {"plane origin NaN", face(kSquare, {}, {{0, kNaN, 0}, {1, 0, 0}, {0, 0, 1}})},
      {"plane origin Infinity", face(kSquare, {}, {{0, 0, kInf}, {1, 0, 0}, {0, 0, 1}})},
      {"plane xDir not unit", face(kSquare, {}, {{0, 0, 0}, {2, 0, 0}, {0, 0, 1}})},
      {"plane normal not unit", face(kSquare, {}, {{0, 0, 0}, {1, 0, 0}, {0, 0, 0.5}})},
      {"plane axes not perpendicular", face(kSquare, {}, {{0, 0, 0}, {1, 0, 0}, {s, 0, s}})},
      {"outer empty", face({})},
      {"an empty hole", face(kSquare, {{}})},
      {"a line point NaN", face(polygon({{0, 0}, {4, kNaN}, {4, 4}}))},
      {"a circle of radius 0", face({circle({0, 0}, 0)})},
      {"a circle of negative radius", face({circle({0, 0}, -1)})},
      {"a circle of radius NaN", face({circle({0, 0}, kNaN)})},
      {"a circle of radius Infinity", face({circle({0, 0}, kInf)})},
      {"a circle with an invalid center", face({circle({kNaN, 0}, 1)})},
      {"a circle inside a loop of several curves",
       face({kSquare[0], kSquare[1], kSquare[2], kSquare[3], kHole[0]})},
      {"two circles in one loop", face({kHole[0], kHole[0]})},
      {"an open loop", face({kSquare[0], kSquare[1], kSquare[2]})},
      {"a gap between two curves",
       face({line({0, 0}, {1, 0}), line({1, 1e-6}, {0, 1}), line({0, 1}, {0, 0})})},
      {"a gap beyond 1e-7 · |coordinate|",
       face({line({1e5, 0}, {1e5 + 1, 0}), line({1e5 + 1 + 2e-2, 0}, {1e5, 1}),
             line({1e5, 1}, {1e5, 0})})},
      {"a single line", face({line({0, 0}, {1, 0})})},
      {"a line of zero length",
       face({kSquare[0], kSquare[1], kSquare[2], kSquare[3], line({0, 0}, {0, 0})})},
      {"an arc of zero length",
       face({kSquare[0], kSquare[1], kSquare[2], kSquare[3], arc({1, 1}, {0, 0}, {0, 0}, true)})},
      {"an arc with unequal radii",
       face({line({0, -1}, {0, 1.1}), arc({0, 0}, {0, 1.1}, {0, -1}, true)})},
      {"an arc of radius 1e-10",
       face({line({0, -1e-10}, {0, 1e-10}), arc({0, 0}, {0, 1e-10}, {0, -1e-10}, true)})},
      {"an invalid hole", face(kSquare, {{circle({2, 2}, 0)}})},
      {"a spline of degree 0", face(splineLoop(degree0))},
      {"a spline with too few poles for its degree", face(splineLoop(fewPoles))},
      {"a spline pole Infinity", face(splineLoop(poleInf))},
      {"spline knots of the wrong length", face(splineLoop(shortKnots))},
      {"a spline knot NaN", face(splineLoop(knotNaN))},
      {"decreasing spline knots", face(splineLoop(decreasing))},
      {"a spline whose first pole is off the end of the previous curve",
       face(splineLoop(offStart))},
      {"a spline whose last pole is off the start of the next curve", face(splineLoop(offEnd))},
      {"an open spline alone", face({aSpline()})},
      {"a spline of degree 26", face(splineLoop(degree26))},
      {"knots not clamped at the start",
       face(splineLoop(cubicSide({0, 0, 0, 0.1, 0.3, 0.5, 0.7, 1, 1, 1, 1})))},
      {"knots not clamped at the end",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0.3, 0.5, 0.7, 0.9, 1, 1, 1})))},
      {"all knots equal", face(splineLoop(cubicSide({1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1})))},
      {"the first knot larger than the last",
       face(splineLoop(cubicSide({1, 1, 1, 1, 0.7, 0.5, 0.3, 0, 0, 0, 0})))},
      {"an interior knot equal to the first",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0, 0.5, 0.7, 1, 1, 1, 1})))},
      {"an interior knot equal to the last",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0.3, 0.5, 1, 1, 1, 1, 1})))},
      {"an interior knot outside the range",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0.3, 1.5, 0.7, 1, 1, 1, 1})))},
      {"decreasing interior knots",
       face(splineLoop(cubicSide({0, 0, 0, 0, 0.7, 0.5, 0.3, 1, 1, 1, 1})))},
      {"an interior knot repeated more than degree times", face(splineLoop(repeatedTooOften))},
  };
  for (const auto& [name, input] : cases) EXPECT_NE(validateFaceInput(input), kNone) << name;
}

TEST(ValidateFaceInput, NamesTheKnotProblemOfASpline) {
  const auto errors =
      validateFaceInput(face(splineLoop(cubicSide({0, 0, 0, 0, 0.7, 0.5, 0.3, 1, 1, 1, 1}))));
  EXPECT_NE(joined(errors).find("outer[2]: knots must not decrease"), std::string::npos);
}

TEST(ValidateFaceInput, NamesWhereTheProblemIs) {
  const auto errors = validateFaceInput(face(kSquare, {kHole, {circle({2, 2}, 0)}}));
  EXPECT_NE(joined(errors).find("holes[1]"), std::string::npos);
}

TEST(ValidateFaceInput, ReportsEveryInvalidLoop) {
  const ProfileLoop bad{circle({0, 0}, 0)};
  EXPECT_GE(validateFaceInput(face(bad, {bad})).size(), 2U);
}

TEST(ValidateFaceInput, AnIdIsOptional) {
  EXPECT_EQ(validateFaceInput(face({circle({0, 0}, 1, "c1")})), kNone);
  EXPECT_EQ(validateFaceInput(face(polygon({{0, 0}, {1, 0}, {0, 1}}, "l"))), kNone);
}

TEST(ParseProfileRegionsInput, CopiesTheCurvesWithoutTheZeroLengthOnes) {
  const std::vector<ProfileCurve> curves{
      line({0, 0}, {1, 0}, "a"), line({5, 5}, {5, 5}, "z"),
      arc({8, 5}, {10, 5}, {10, 5}, true, "y"),
      Curve2::bspline(2, {{1, 1}, {1, 1}, {1, 1}}, {0, 0, 0, 1, 1, 1}, "x"),
      circle({0, 0}, 1, "k")};
  const auto parsed = parseProfileRegionsInput(curves);
  ASSERT_TRUE(parsed.has_value());
  ASSERT_EQ(parsed->size(), 2U);
  EXPECT_EQ((*parsed)[0], curves[0]);
  EXPECT_EQ((*parsed)[1], curves[4]);
}

TEST(ParseProfileRegionsInput, RejectsInvalidCurves) {
  const ProfileLoop rect = polygon({{0, 0}, {10, 0}, {10, 5}, {0, 5}}, "r");
  const auto with = [&rect](const ProfileCurve& extra) {
    std::vector<ProfileCurve> curves(rect.begin(), rect.end());
    curves.push_back(extra);
    return curves;
  };
  Curve2 unclamped =
      Curve2::bspline(2, {{20, 0}, {21, 1}, {22, 0}}, {0, 0.5, 0.5, 0.5, 1, 1}, "sp");
  const std::vector<std::pair<std::string, std::vector<ProfileCurve>>> cases{
      {"a curve without id", with(line({0, 0}, {1, 1}))},
      {"a duplicate id", with(line({20, 0}, {21, 1}, "r1"))},
      {"a duplicate id of a zero-length line", with(line({20, 0}, {20, 0}, "r1"))},
      {"an infinite coordinate", with(line({20, 0}, {kInf, 1}, "x"))},
      {"a NaN radius", with(circle({5, 2}, kNaN, "k"))},
      {"a zero radius", with(circle({5, 2}, 0, "k"))},
      {"an arc with unequal radii", with(arc({20, 0}, {21, 0}, {20, 2}, true, "q"))},
      {"a spline with unclamped knots", with(unclamped)},
  };
  for (const auto& [name, curves] : cases) {
    const auto parsed = parseProfileRegionsInput(curves);
    EXPECT_FALSE(parsed.has_value()) << name;
  }
}

TEST(ParseProfileRegionsInput, ReportsEveryProblem) {
  const auto parsed = parseProfileRegionsInput(
      {line({0, 0}, {1, 0}), circle({0, 0}, 0, "k"), line({0, 0}, {1, 0}, "k")});
  ASSERT_FALSE(parsed.has_value());
  EXPECT_EQ(parsed.error().size(), 3U);
}

}  // namespace
}  // namespace tinycad::kernel
