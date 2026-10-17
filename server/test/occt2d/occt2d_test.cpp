// tinycad_occt2d, the 2D base of tinycad_kernel and tinycad_geometry (decision N77). The main
// evidence are the kernel and geometry tests and the shared cases, which run over it; here only
// the pieces with an edge worth pinning down on their own.

#include <gtest/gtest.h>

#include <Geom2d_Curve.hxx>
#include <gp_Pnt2d.hxx>

#include <string>
#include <utility>
#include <vector>

#include "tinycad/occt2d/boxes.hpp"
#include "tinycad/occt2d/curve_checks.hpp"
#include "tinycad/occt2d/curves.hpp"

namespace tinycad::occt2d {
namespace {

constexpr CurveRules kFaceCurve{false, false};
constexpr CurveRules kRegionCurve{true, true};

Vec2 pointAt(const Handle(Geom2d_Curve) & curve, double u) {
  const gp_Pnt2d p = curve->Value(u);
  return {p.X(), p.Y()};
}

void expectNear(Vec2 actual, Vec2 expected) {
  EXPECT_NEAR(actual[0], expected[0], 1e-12);
  EXPECT_NEAR(actual[1], expected[1], 1e-12);
}

TEST(CompressKnots, GroupsEqualKnotsWithTheirMultiplicities) {
  const CompressedKnots compressed = compressKnots({0, 0, 0, 0.5, 1, 1, 1});
  EXPECT_EQ(compressed.knots, (std::vector<double>{0, 0.5, 1}));
  EXPECT_EQ(compressed.multiplicities, (std::vector<int>{3, 1, 3}));
}

TEST(CompressKnots, EmptyVectorGivesNothing) {
  const CompressedKnots compressed = compressKnots({});
  EXPECT_TRUE(compressed.knots.empty());
  EXPECT_TRUE(compressed.multiplicities.empty());
}

TEST(SamePoint, AgreesWithinTheRelativeTolerance) {
  EXPECT_TRUE(samePoint({1, 1}, {1 + 0.9 * kPointTolerance, 1}));
  EXPECT_FALSE(samePoint({1, 1}, {1 + 1.1 * kPointTolerance, 1}));
  // Scaled by the larger coordinate: at 1000 the same gap is 1000 times smaller.
  EXPECT_TRUE(samePoint({1000, 0}, {1000 + 0.9e3 * kPointTolerance, 0}));
  EXPECT_FALSE(samePoint({1000, 0}, {1000 + 1.1e3 * kPointTolerance, 0}));
  // Near zero the scale is 1, never smaller.
  EXPECT_TRUE(samePoint({0, 0}, {0, 0.9 * kPointTolerance}));
  EXPECT_FALSE(samePoint({0, 0}, {0, 1.1 * kPointTolerance}));
}

TEST(OverlappingPairs, TouchingBoxesOverlap) {
  const std::vector<Box> boxes{{0, 0, 1, 1}, {1, 0, 2, 1}};
  EXPECT_EQ(overlappingPairs(boxes), (std::vector<std::pair<std::size_t, std::size_t>>{{0, 1}}));
}

TEST(OverlappingPairs, SeparateBoxesGiveNoPair) {
  const std::vector<Box> boxes{{0, 0, 1, 1}, {2, 0, 3, 1}, {0, 2, 1, 3}};
  EXPECT_TRUE(overlappingPairs(boxes).empty());
}

TEST(OverlappingPairs, PairsAreOrderedByIndexWhateverTheSweepOrder) {
  // The sweep visits box 1 first (smaller minX); the pair is still (0, 1).
  const std::vector<Box> boxes{{1, 0, 3, 1}, {0, 0, 2, 1}};
  EXPECT_EQ(overlappingPairs(boxes), (std::vector<std::pair<std::size_t, std::size_t>>{{0, 1}}));
}

TEST(BoundedCurve, LineRunsFromItsStartToItsEnd) {
  const Handle(Geom2d_Curve) curve = boundedCurve(Curve2::line({1, 2}, {4, 6}));
  expectNear(pointAt(curve, curve->FirstParameter()), {1, 2});
  expectNear(pointAt(curve, curve->LastParameter()), {4, 6});
}

TEST(BoundedCurve, CounterClockwiseArcRunsFromItsStartToItsEnd) {
  const Curve2 arc = Curve2::arc({0, 0}, {1, 0}, {0, 1}, true);
  const Handle(Geom2d_Curve) curve = boundedCurve(arc);
  expectNear(pointAt(curve, curve->FirstParameter()), {1, 0});
  expectNear(pointAt(curve, curve->LastParameter()), {0, 1});
}

TEST(BoundedCurve, ClockwiseArcTurnedCounterClockwiseSwapsItsEnds) {
  const Curve2 arc = counterClockwise(Curve2::arc({0, 0}, {0, 1}, {1, 0}, false));
  const Handle(Geom2d_Curve) curve = boundedCurve(arc);
  expectNear(pointAt(curve, curve->FirstParameter()), {1, 0});
  expectNear(pointAt(curve, curve->LastParameter()), {0, 1});
}

TEST(BoundedCurve, SplineRunsFromItsFirstToItsLastPole) {
  const Curve2 spline = Curve2::bspline(2, {{0, 0}, {1, 2}, {3, 0}}, {0, 0, 0, 1, 1, 1});
  const Handle(Geom2d_Curve) curve = boundedCurve(spline);
  expectNear(pointAt(curve, curve->FirstParameter()), {0, 0});
  expectNear(pointAt(curve, curve->LastParameter()), {3, 0});
}

TEST(ReadCurve, RejectsAKnotVectorThatIsNotClamped) {
  std::vector<std::string> problems;
  const Curve2 spline = Curve2::bspline(2, {{0, 0}, {1, 2}, {3, 0}}, {0, 0, 0.5, 1, 1, 1});
  EXPECT_EQ(readCurve(spline, "curves[0]", problems, kFaceCurve), CurveRead::Bad);
  ASSERT_EQ(problems.size(), 1u);
  EXPECT_EQ(problems[0].rfind("curves[0]: ", 0), 0u) << problems[0];
}

TEST(ReadCurve, KnotsProblemAcceptsAClampedVectorOutsideZeroToOne) {
  EXPECT_FALSE(knotsProblem({2, 2, 2, 3, 5, 5, 5}, 2).has_value());
  EXPECT_TRUE(knotsProblem({0, 0, 0, 1, 1, 1, 0.5}, 2).has_value());
}

TEST(ReadCurve, IdIsRequiredOnlyWhenTheRulesSaySo) {
  const Curve2 line = Curve2::line({0, 0}, {1, 0});
  std::vector<std::string> problems;
  EXPECT_EQ(readCurve(line, "curve", problems, kFaceCurve), CurveRead::Ok);
  EXPECT_TRUE(problems.empty());
  EXPECT_EQ(readCurve(line, "curves[1]", problems, kRegionCurve), CurveRead::Bad);
  ASSERT_EQ(problems.size(), 1u);
  EXPECT_EQ(problems[0].rfind("curves[1]: ", 0), 0u) << problems[0];
}

TEST(ReadCurve, ZeroLengthIsSkippedOrBadByTheRules) {
  std::vector<std::string> problems;
  const Curve2 line = Curve2::line({1, 1}, {1, 1}, "l");
  EXPECT_EQ(readCurve(line, "curves[0]", problems, kRegionCurve), CurveRead::Skip);
  EXPECT_TRUE(problems.empty());
  EXPECT_EQ(readCurve(line, "curve", problems, kFaceCurve), CurveRead::Bad);
  EXPECT_EQ(problems.size(), 1u);
}

TEST(ReadCurve, SplineWithAllPolesInOnePointIsZeroLength) {
  std::vector<std::string> problems;
  const Curve2 spline = Curve2::bspline(1, {{2, 2}, {2, 2}}, {0, 0, 1, 1}, "s");
  EXPECT_EQ(readCurve(spline, "curves[0]", problems, kRegionCurve), CurveRead::Skip);
  EXPECT_TRUE(problems.empty());
}

}  // namespace
}  // namespace tinycad::occt2d
