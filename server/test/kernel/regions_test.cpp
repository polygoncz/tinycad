// Regions of a sketch: the contract blocks `regions (spec 12 Oblasti)`, `regions with splines
// (M29)` and `input (spec 06 profileRegions)` of src/kernel/testing.ts and
// test/unit/kernel-occt/occt-regions.test.ts. Compared as spec 06 says: name, crossing, the
// number and names of holes exactly, the area relatively (1e-6, splines 1e-3) and the points of
// the loops within 1e-7 · max(1, |coordinate|); curves are found by their id.

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <set>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite
using core::Curve2;

constexpr double kRegionAreaTolerance = 1e-6;
constexpr double kSplineAreaTolerance = 1e-3;
constexpr double kLoopPointTolerance = 1e-7;
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kPi = std::numbers::pi;

Curve2 seg(std::string id, Vec2 from, Vec2 to) { return line(from, to, std::move(id)); }
Curve2 ccwArc(std::string id, Vec2 center, Vec2 from, Vec2 to) {
  return arc(center, from, to, true, std::move(id));
}
Curve2 ring(std::string id, Vec2 center, double radius) {
  return circle(center, radius, std::move(id));
}

/** A counter-clockwise rectangle with lines ab bc cd da (with the id prefix) from (x, y). */
std::vector<Curve2> rectangle(const std::string& prefix = {}, double x = 0, double y = 0,
                              double width = 10, double height = 5) {
  const Vec2 a{x, y};
  const Vec2 b{x + width, y};
  const Vec2 c{x + width, y + height};
  const Vec2 d{x, y + height};
  return {seg(prefix + "ab", a, b), seg(prefix + "bc", b, c), seg(prefix + "cd", c, d),
          seg(prefix + "da", d, a)};
}

/** The curves with their ids in upper case (rectangles with ids AB BC CD DA). */
std::vector<Curve2> upper(std::vector<Curve2> curves) {
  for (Curve2& c : curves) std::transform(c.id.begin(), c.id.end(), c.id.begin(), ::toupper);
  return curves;
}

std::vector<Curve2> concat(std::vector<Curve2> a, const std::vector<Curve2>& b) {
  a.insert(a.end(), b.begin(), b.end());
  return a;
}

const std::vector<Curve2> kRect = rectangle();
const std::vector<Curve2> kTriangle{seg("pq", {2, 1}, {4, 1}), seg("qr", {4, 1}, {4, 3}),
                                    seg("rp", {4, 3}, {2, 1})};
const std::vector<Curve2> kSlot{
    seg("l1", {0, 0}, {10, 0}), ccwArc("a1", {10, 5}, {10, 0}, {10, 10}),
    seg("l2", {10, 10}, {0, 10}), ccwArc("a2", {0, 5}, {0, 10}, {0, 0})};
const Curve2 kSplineBC = spline("bc", {{10, 0}, {13, 1}, {13, 4}, {10, 5}});
const std::vector<Curve2> kSplineRect{seg("ab", {0, 0}, {10, 0}), kSplineBC,
                                      seg("cd", {10, 5}, {0, 5}), seg("da", {0, 5}, {0, 0})};
const std::vector<Vec2> kSquarePoles{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {0, 0}};

Curve2 closedSpline(std::vector<Vec2> poles,
                    std::vector<double> knots = {0, 0, 0, 0, 0.5, 1, 1, 1, 1}) {
  return Curve2::bspline(3, std::move(poles), std::move(knots), "sp");
}

bool nearCoordinate(double a, double b) {
  return std::abs(a - b) <= kLoopPointTolerance * std::max({1.0, std::abs(a), std::abs(b)});
}

void expectPointClose(Vec2 actual, Vec2 expected, const std::string& what) {
  EXPECT_TRUE(nearCoordinate(actual[0], expected[0]) && nearCoordinate(actual[1], expected[1]))
      << what << ": (" << actual[0] << ", " << actual[1] << ") vs (" << expected[0] << ", "
      << expected[1] << ")";
}

/** The same curve within the contract tolerance: kind, id, orientation and every point. */
void expectCurveClose(const Curve2* actual, const Curve2& expected) {
  const std::string what = "curve " + expected.id;
  ASSERT_NE(actual, nullptr) << what << " missing";
  ASSERT_EQ(actual->kind, expected.kind) << what;
  EXPECT_EQ(actual->id, expected.id);
  switch (expected.kind) {
    case Curve2::Kind::Circle:
      expectPointClose(actual->center, expected.center, what + " center");
      EXPECT_TRUE(nearCoordinate(actual->radius, expected.radius)) << what;
      break;
    case Curve2::Kind::Line:
      expectPointClose(actual->from, expected.from, what + " from");
      expectPointClose(actual->to, expected.to, what + " to");
      break;
    case Curve2::Kind::Arc:
      EXPECT_EQ(actual->ccw, expected.ccw) << what;
      expectPointClose(actual->center, expected.center, what + " center");
      expectPointClose(actual->from, expected.from, what + " from");
      expectPointClose(actual->to, expected.to, what + " to");
      break;
    case Curve2::Kind::BSpline:
      EXPECT_EQ(actual->degree, expected.degree) << what;
      ASSERT_EQ(actual->poles.size(), expected.poles.size()) << what;
      for (std::size_t i = 0; i < expected.poles.size(); ++i) {
        expectPointClose(actual->poles[i], expected.poles[i], what + " pole");
      }
      ASSERT_EQ(actual->knots.size(), expected.knots.size()) << what;
      for (std::size_t i = 0; i < expected.knots.size(); ++i) {
        EXPECT_TRUE(nearCoordinate(actual->knots[i], expected.knots[i])) << what << " knot " << i;
      }
      break;
  }
}

std::vector<std::string> idsOf(const ProfileLoop& loop) {
  std::vector<std::string> ids;
  for (const Curve2& c : loop) ids.push_back(c.id);
  std::sort(ids.begin(), ids.end());
  return ids;
}

const Curve2* findId(const ProfileLoop& loop, const std::string& id) {
  const auto found =
      std::find_if(loop.begin(), loop.end(), [&](const Curve2& c) { return c.id == id; });
  return found == loop.end() ? nullptr : &*found;
}

/** The loop has exactly the expected curves (found by id, in any order and from any start). */
void expectLoopCurves(const ProfileLoop& loop, const std::vector<Curve2>& expected) {
  EXPECT_EQ(idsOf(loop), idsOf(expected));
  for (const Curve2& e : expected) expectCurveClose(findId(loop, e.id), e);
}

Vec2 startPoint(const Curve2& c) {
  return c.kind == Curve2::Kind::BSpline ? c.poles.front() : c.from;
}
Vec2 endPoint(const Curve2& c) { return c.kind == Curve2::Kind::BSpline ? c.poles.back() : c.to; }

/** Every curve ends where the next one starts (a lone circle is closed by itself). */
void expectLoopClosed(const ProfileLoop& loop) {
  if (loop.size() == 1 && loop[0].kind == Curve2::Kind::Circle) return;
  ASSERT_FALSE(loop.empty());
  for (std::size_t i = 0; i < loop.size(); ++i) {
    expectPointClose(endPoint(loop[i]), startPoint(loop[(i + 1) % loop.size()]),
                     "end of " + std::to_string(i));
  }
}

/** Signed area of a closed loop: shoelace plus circular segments, splines densely sampled. */
double loopArea(const ProfileLoop& loop) {
  double sum = 0;
  for (const Curve2& c : loop) {
    if (c.kind == Curve2::Kind::Circle) return kPi * c.radius * c.radius;
    const std::vector<Vec2> points =
        c.kind == Curve2::Kind::BSpline ? splinePoints(c, 2000) : std::vector<Vec2>{c.from, c.to};
    for (std::size_t i = 1; i < points.size(); ++i) {
      sum += (points[i - 1][0] * points[i][1] - points[i][0] * points[i - 1][1]) / 2;
    }
    if (c.kind == Curve2::Kind::Arc) {
      const double r = std::hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]);
      const double a0 = std::atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
      const double a1 = std::atan2(c.to[1] - c.center[1], c.to[0] - c.center[0]);
      const auto turn = [](double x) { return std::fmod(std::fmod(x, kTurn) + kTurn, kTurn); };
      const double sweep = c.ccw ? turn(a1 - a0) : turn(a0 - a1);
      const double segment = r * r * (sweep - std::sin(sweep)) / 2;
      sum += c.ccw ? segment : -segment;
    }
  }
  return sum;
}

std::string holeName(const ProfileLoop& loop) {
  std::set<std::string> ids;
  for (const Curve2& c : loop) ids.insert(c.id);
  std::string name;
  for (const std::string& id : ids) name += (name.empty() ? "" : ",") + id;
  return name;
}

struct Expected {
  std::string name;
  std::vector<std::string> holes;
  double area;
  double areaTolerance = kRegionAreaTolerance;
};

void expectAreaClose(double actual, double expected, double tolerance, const std::string& what) {
  EXPECT_LE(std::abs(actual - expected), tolerance * std::abs(expected))
      << what << ": area " << actual << " vs " << expected;
}

/**
 * The regions are exactly the expected ones in this order, without a crossing; every outer loop
 * closed and counter-clockwise, every hole closed and clockwise.
 */
void expectRegions(const ProfileRegions& actual, const std::vector<Expected>& expected) {
  EXPECT_FALSE(actual.crossing);
  std::vector<std::string> names;
  for (const ProfileRegion& r : actual.regions) names.push_back(r.name);
  std::vector<std::string> expectedNames;
  for (const Expected& e : expected) expectedNames.push_back(e.name);
  ASSERT_EQ(names, expectedNames);
  for (std::size_t i = 0; i < expected.size(); ++i) {
    const ProfileRegion& r = actual.regions[i];
    const Expected& e = expected[i];
    std::vector<std::string> holes;
    for (const ProfileLoop& h : r.holes) holes.push_back(holeName(h));
    std::sort(holes.begin(), holes.end());
    std::vector<std::string> expectedHoles = e.holes;
    std::sort(expectedHoles.begin(), expectedHoles.end());
    EXPECT_EQ(holes, expectedHoles) << "holes of " << r.name;
    expectAreaClose(r.area, e.area, e.areaTolerance, r.name);
    expectLoopClosed(r.outer);
    EXPECT_GT(loopArea(r.outer), 0) << "outer of " << r.name << " counter-clockwise";
    for (const ProfileLoop& hole : r.holes) {
      expectLoopClosed(hole);
      if (hole.size() > 1 || hole[0].kind != Curve2::Kind::Circle) {
        EXPECT_LT(loopArea(hole), 0) << "hole " << holeName(hole) << " clockwise";
      }
    }
  }
}

void expectCrossing(const ProfileRegions& actual) {
  EXPECT_TRUE(actual.crossing);
  EXPECT_TRUE(actual.regions.empty());
}

void expectNoRegions(const ProfileRegions& actual) {
  EXPECT_FALSE(actual.crossing);
  EXPECT_TRUE(actual.regions.empty());
}

class Regions : public ::testing::Test {
 protected:
  ProfileRegions regionsOf(const std::vector<Curve2>& curves) {
    return ok(kernel.profileRegions(curves));
  }

  std::vector<std::string> namesOf(const std::vector<Curve2>& curves) {
    std::vector<std::string> names;
    for (const ProfileRegion& r : regionsOf(curves).regions) names.push_back(r.name);
    return names;
  }

  OcctKernel kernel;
};

// --- regions (spec 12 Oblasti) ----------------------------------------------------------------

TEST_F(Regions, ARectangleIsOneCounterClockwiseRegionNamedAfterItsFourLines) {
  const ProfileRegions result = regionsOf(kRect);
  expectRegions(result, {{"ab,bc,cd,da", {}, 50}});
  ASSERT_EQ(result.regions.size(), 1U);
  EXPECT_EQ(result.regions[0].outer.size(), 4U);
  expectLoopCurves(result.regions[0].outer, kRect);
}

TEST_F(Regions, TwoRectanglesSharingAnEdgeAreTwoRegions) {
  expectRegions(regionsOf(concat(kRect, {seg("be", {10, 0}, {20, 0}), seg("ef", {20, 0}, {20, 5}),
                                         seg("fc", {20, 5}, {10, 5})})),
                {{"ab,bc,cd,da", {}, 50}, {"bc,be,ef,fc", {}, 50}});
}

TEST_F(Regions, ACircleInsideARectangleIsAHoleAndARegionOfItsOwn) {
  const Curve2 k = ring("k", {5, 2.5}, 2);
  const ProfileRegions result = regionsOf(concat(kRect, {k}));
  expectRegions(result, {{"ab,bc,cd,da,k", {"k"}, 50 - 4 * kPi}, {"k", {}, 4 * kPi}});
  expectLoopCurves(result.regions[0].holes.at(0), {k});
  expectLoopCurves(result.regions[1].outer, {k});
}

TEST_F(Regions, APolygonHoleIsClockwise) {
  const ProfileRegions result = regionsOf(concat(kRect, kTriangle));
  expectRegions(result, {{"ab,bc,cd,da,pq,qr,rp", {"pq,qr,rp"}, 48}, {"pq,qr,rp", {}, 2}});
  EXPECT_NEAR(loopArea(result.regions[0].holes.at(0)), -2, 1e-9);
}

TEST_F(Regions, CircleInCircleInCircle) {
  expectRegions(regionsOf({ring("k1", {1, 1}, 10), ring("k2", {1, 1}, 5), ring("k3", {1, 1}, 2)}),
                {{"k1,k2", {"k2"}, 75 * kPi}, {"k2,k3", {"k3"}, 21 * kPi}, {"k3", {}, 4 * kPi}});
}

TEST_F(Regions, ASlotOfLinesAndTangentArcsIsOneRegion) {
  const ProfileRegions result = regionsOf(kSlot);
  expectRegions(result, {{"a1,a2,l1,l2", {}, 100 + 25 * kPi}});
  expectLoopCurves(result.regions[0].outer, kSlot);
}

TEST_F(Regions, OrdersALineAndATangentArcLeavingANodeByCurvature) {
  const ProfileRegions result = regionsOf(
      {seg("ab", {0, 0}, {10, 0}), seg("bc", {10, 0}, {5, 5}), ccwArc("q", {0, 5}, {0, 0}, {5, 5}),
       seg("ae", {0, 0}, {0, -5}), seg("eb", {0, -5}, {10, 0})});
  expectRegions(result, {{"ab,ae,eb", {}, 25}, {"ab,bc,q", {}, 25 - 12.5 * (kPi / 2 - 1)}});
  // Traversed counter-clockwise, the arc runs backwards (clockwise).
  expectCurveClose(findId(result.regions[1].outer, "q"), arc({0, 5}, {5, 5}, {0, 0}, false, "q"));
}

TEST_F(Regions, AnOpenPolylineAndNoCurvesBoundNothing) {
  expectNoRegions(regionsOf({seg("ab", {0, 0}, {10, 0}), seg("bc", {10, 0}, {10, 5})}));
  expectNoRegions(regionsOf({}));
}

TEST_F(Regions, PrunesADanglingTail) {
  expectRegions(regionsOf(concat(kRect, {seg("t", {10, 5}, {15, 8}), seg("u", {15, 8}, {20, 8})})),
                {{"ab,bc,cd,da", {}, 50}});
}

TEST_F(Regions, CrossingCurvesGiveNoRegions) {
  const std::vector<std::pair<std::string, std::vector<Curve2>>> cases{
      {"crossing lines", {seg("pq", {0, 0}, {10, 10}), seg("rs", {0, 10}, {10, 0})}},
      {"a line across a rectangle", concat(kRect, {seg("pq", {-5, 2}, {15, 2})})},
      {"an end touching the inside of a line", concat(kRect, {seg("pq", {5, 0}, {5, -5})})},
      {"overlapping collinear lines", concat(kRect, {seg("pq", {2, 0}, {6, 0})})},
      {"a circle through a rectangle edge", concat(kRect, {ring("k", {10, 2.5}, 1)})},
      {"a circle touching a rectangle edge", concat(kRect, {ring("k", {5, 4}, 1)})},
      {"two overlapping circles", {ring("k1", {0, 0}, 2), ring("k2", {1, 0}, 2)}},
      {"equal concentric circles", {ring("k1", {0, 0}, 2), ring("k2", {0, 0}, 2)}},
  };
  for (const auto& [name, curves] : cases) {
    SCOPED_TRACE(name);
    expectCrossing(regionsOf(curves));
  }
}

TEST_F(Regions, CurvesWhoseEndsLieAtTheSameCoordinatesShareANode) {
  expectRegions(regionsOf({seg("ab", {0, 0}, {10, 0}), seg("bc", {10, 0}, {10, 5}),
                           seg("ca", {10, 5}, {0, 0})}),
                {{"ab,bc,ca", {}, 25}});
}

TEST_F(Regions, KeepsTheNameWhenCoordinatesCurveOrderAndOrientationChange) {
  const Vec2 a{3, -4};
  const Vec2 b{47, -4};
  const Vec2 c{47, 12};
  const Vec2 d{3, 12};
  expectRegions(regionsOf({seg("cd", d, c), seg("ab", a, b), seg("da", d, a), seg("bc", c, b)}),
                {{"ab,bc,cd,da", {}, 44 * 16}});
}

TEST_F(Regions, AClockwiseArcInTheInputIsTheSameArc) {
  std::vector<Curve2> reversed = kSlot;
  reversed[1] = arc(kSlot[1].center, kSlot[1].to, kSlot[1].from, false, "a1");
  const ProfileRegions result = regionsOf(reversed);
  expectRegions(result, {{"a1,a2,l1,l2", {}, 100 + 25 * kPi}});
  expectLoopCurves(result.regions[0].outer, kSlot);
}

TEST_F(Regions, EveryCurveOfALoopCarriesTheIdOfItsLine) {
  EXPECT_EQ(idsOf(regionsOf(kRect).regions.at(0).outer),
            (std::vector<std::string>{"ab", "bc", "cd", "da"}));
  const ProfileRegions result = regionsOf(concat(kRect, kTriangle));
  ASSERT_EQ(result.regions.size(), 2U);
  ASSERT_EQ(result.regions[0].holes.size(), 1U);
  const std::vector<std::string> triangle{"pq", "qr", "rp"};
  EXPECT_EQ(idsOf(result.regions[0].holes[0]), triangle);
  EXPECT_EQ(idsOf(result.regions[1].outer), triangle);
}

TEST_F(Regions, ASlotAsAHoleIsClockwiseSoItsArcsAreReversed) {
  const ProfileRegions result = regionsOf(concat(kSlot, upper(rectangle("", -20, -20, 50, 50))));
  expectRegions(result, {{"AB,BC,CD,DA,a1,a2,l1,l2", {"a1,a2,l1,l2"}, 2500 - 100 - 25 * kPi},
                         {"a1,a2,l1,l2", {}, 100 + 25 * kPi}});
  expectLoopCurves(result.regions[0].holes.at(0),
                   {seg("l1", {10, 0}, {0, 0}), arc({10, 5}, {10, 10}, {10, 0}, false, "a1"),
                    seg("l2", {0, 10}, {10, 10}), arc({0, 5}, {0, 0}, {0, 10}, false, "a2")});
}

TEST_F(Regions, SortsNamesByStringComparison) {
  EXPECT_EQ(namesOf(concat(rectangle("B"), rectangle("A", 20))),
            (std::vector<std::string>{"Aab,Abc,Acd,Ada", "Bab,Bbc,Bcd,Bda"}));
}

// --- regions with splines (M29) ---------------------------------------------------------------

TEST_F(Regions, ARectangleWithASplineSideIsOneRegionCarryingTheExactSpline) {
  const double area = areaWith({Vec2{0, 0}, kSplineBC, Vec2{10, 5}, Vec2{0, 5}});
  EXPECT_GT(area, 50);
  const ProfileRegions result = regionsOf(kSplineRect);
  expectRegions(result, {{"ab,bc,cd,da", {}, area, kSplineAreaTolerance}});
  EXPECT_EQ(result.regions.at(0).outer.size(), 4U);
  // Traversed counter-clockwise, the spline runs forward (b → c).
  expectLoopCurves(result.regions[0].outer, kSplineRect);
}

TEST_F(Regions, ARectangleWithAFitSplineSideIsOneRegion) {
  // bspline.interpolate([10, 0], [12, 2.5], [10, 5]) of core.
  const Curve2 side = Curve2::bspline(2, {{10, 0}, {14, 2.5}, {10, 5}}, {0, 0, 0, 1, 1, 1}, "bc");
  const std::vector<Curve2> curves{seg("ab", {0, 0}, {10, 0}), side, seg("cd", {10, 5}, {0, 5}),
                                   seg("da", {0, 5}, {0, 0})};
  const ProfileRegions result = regionsOf(curves);
  expectRegions(result, {{"ab,bc,cd,da",
                          {},
                          areaWith({Vec2{0, 0}, side, Vec2{10, 5}, Vec2{0, 5}}),
                          kSplineAreaTolerance}});
  expectLoopCurves(result.regions[0].outer, curves);
}

TEST_F(Regions, AClosedSplineIsALoopWithOneNode) {
  const Curve2 sp = closedSpline(kSquarePoles);
  const ProfileRegions result = regionsOf({sp});
  expectRegions(result, {{"sp", {}, areaWith({sp}), kSplineAreaTolerance}});
  EXPECT_EQ(result.regions.at(0).outer.size(), 1U);
  expectLoopCurves(result.regions[0].outer, {sp});
}

TEST_F(Regions, AClockwiseClosedSplineIsReversedInTheCounterClockwiseOuterLoop) {
  std::vector<Vec2> poles(kSquarePoles.rbegin(), kSquarePoles.rend());
  const Curve2 sp = closedSpline(poles, {0, 0, 0, 0, 0.25, 1, 1, 1, 1});
  const ProfileRegions result = regionsOf({sp});
  ASSERT_EQ(result.regions.size(), 1U);
  EXPECT_EQ(result.regions[0].name, "sp");
  // Reversed: poles in the opposite order, knots mirrored (k → 1 − k, reversed).
  expectLoopCurves(result.regions[0].outer,
                   {closedSpline(kSquarePoles, {0, 0, 0, 0, 0.75, 1, 1, 1, 1})});
  expectAreaClose(result.regions[0].area, -areaWith({sp}), kSplineAreaTolerance, "sp");
}

TEST_F(Regions, AClosedSplineInsideARectangleIsAClockwiseHoleAndARegionOfItsOwn) {
  const Curve2 sp = spline("sp", {{5, 5}, {15, 5}, {15, 15}, {5, 15}, {5, 5}});
  const double splineArea = areaWith({sp});
  expectRegions(regionsOf(concat(upper(rectangle("", 0, 0, 20, 20)), {sp})),
                {{"AB,BC,CD,DA,sp", {"sp"}, 400 - splineArea, kSplineAreaTolerance},
                 {"sp", {}, splineArea, kSplineAreaTolerance}});
}

TEST_F(Regions, CrossingSplinesGiveNoRegions) {
  const std::vector<std::pair<std::string, std::vector<Curve2>>> cases{
      {"a spline across a rectangle", concat(kRect, {spline("sp", {{5, -3}, {6, 2}, {7, 8}}, 2)})},
      {"a spline end touching the inside of a line",
       concat(kRect, {spline("sp", {{5, 0}, {7, -2}, {5, -5}}, 2)})},
      {"a spline through a circle",
       {ring("k", {0, 0}, 2), spline("sp", {{-5, 0}, {0, 1}, {5, 0}}, 2)}},
      {"two crossing splines",
       {spline("sp", {{0, 0}, {5, 10}, {10, 0}}, 2), spline("tq", {{0, 5}, {5, -5}, {10, 5}}, 2)}},
      {"a closed cubic figure eight",
       {spline("sp", {{10, 5}, {20, 10}, {20, 0}, {0, 10}, {0, 0}, {10, 5}})}},
      {"a closed spline a b a running back over itself",
       {spline("sp", {{0, 0}, {10, 0}, {0, 0}}, 2)}},
      {"an open spline turning back onto itself", {spline("sp", {{0, 0}, {10, 0}, {5, 0}}, 2)}},
  };
  for (const auto& [name, curves] : cases) {
    SCOPED_TRACE(name);
    expectCrossing(regionsOf(curves));
  }
}

TEST_F(Regions, KeepsTheNameOfASplineRegionWhenCoordinatesAndCurveOrderChange) {
  const std::vector<Curve2> moved{seg("da", {-3, 12}, {-3, -4}), seg("cd", {30, 12}, {-3, 12}),
                                  spline("bc", {{30, -4}, {40, 2}, {35, 9}, {30, 12}}),
                                  seg("ab", {-3, -4}, {30, -4})};
  EXPECT_EQ(namesOf(kSplineRect), std::vector<std::string>{"ab,bc,cd,da"});
  EXPECT_EQ(namesOf(moved), std::vector<std::string>{"ab,bc,cd,da"});
}

TEST_F(Regions, OrdersALineAndASplineLeavingANodeByCurvature) {
  const Curve2 q = spline("q", {{0, 0}, {5, 0}, {5, 5}}, 2);
  const ProfileRegions result =
      regionsOf({seg("ab", {0, 0}, {10, 0}), seg("bc", {10, 0}, {5, 5}), q,
                 seg("ae", {0, 0}, {0, -5}), seg("eb", {0, -5}, {10, 0})});
  expectRegions(result, {{"ab,ae,eb", {}, 25}, {"ab,bc,q", {}, 50.0 / 3, kSplineAreaTolerance}});
  // Traversed counter-clockwise, the spline runs backwards (c → a).
  expectCurveClose(findId(result.regions[1].outer, "q"), spline("q", {{5, 5}, {5, 0}, {0, 0}}, 2));
}

// --- input (spec 06 profileRegions) -----------------------------------------------------------

TEST_F(Regions, InvalidCurvesFailWithInvalidInput) {
  const Curve2 unclamped =
      Curve2::bspline(2, {{20, 0}, {21, 1}, {22, 0}}, {0, 0.5, 0.5, 0.5, 1, 1}, "sp");
  const std::vector<std::pair<std::string, std::vector<Curve2>>> cases{
      {"a curve without id", concat(kRect, {line({0, 0}, {1, 1})})},
      {"a duplicate id", concat(kRect, {seg("ab", {20, 0}, {21, 1})})},
      {"a duplicate id of a zero-length line", concat(kRect, {seg("ab", {20, 0}, {20, 0})})},
      {"an infinite coordinate", concat(kRect, {seg("x", {20, 0}, {kInf, 1})})},
      {"a NaN radius", concat(kRect, {ring("k", {5, 2}, kNaN)})},
      {"a zero radius", concat(kRect, {ring("k", {5, 2}, 0)})},
      {"an arc with unequal radii", concat(kRect, {ccwArc("q", {20, 0}, {21, 0}, {20, 2})})},
      {"a spline with unclamped knots", concat(kRect, {unclamped})},
  };
  for (const auto& [name, curves] : cases) {
    EXPECT_EQ(codeOf(kernel.profileRegions(curves)), KernelErrorCode::InvalidInput) << name;
  }
}

TEST_F(Regions, ACurveOfZeroLengthIsLeftOut) {
  for (const Curve2& zero : {seg("z", {10, 5}, {10, 5}), ccwArc("z", {8, 5}, {10, 5}, {10, 5}),
                             spline("z", {{10, 5}, {10, 5}, {10, 5}}, 2)}) {
    expectRegions(regionsOf(concat(kRect, {zero})), {{"ab,bc,cd,da", {}, 50}});
  }
}

TEST_F(Regions, CreatesNoHandle) {
  regionsOf(concat(kRect, {ring("k", {5, 2.5}, 2)}));
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

// --- test/unit/kernel-occt/occt-regions.test.ts -----------------------------------------------

std::vector<Curve2> rect(const std::string& prefix, double x0, double y0, double x1, double y1) {
  return {seg(prefix + "1", {x0, y0}, {x1, y0}), seg(prefix + "2", {x1, y0}, {x1, y1}),
          seg(prefix + "3", {x1, y1}, {x0, y1}), seg(prefix + "4", {x0, y1}, {x0, y0})};
}

/** A cubic spline from (4, 3) to (0, 3) waving above and below y = 3. */
const Curve2 kWave = Curve2::bspline(3, {{4, 3}, {3, 5}, {2, 1.5}, {1, 4.5}, {0, 3}},
                                     {0, 0, 0, 0, 0.4, 1, 1, 1, 1}, "w");

void expectExactArea(double actual, double expected, double relative = 1e-9) {
  EXPECT_LE(std::abs(actual - expected), relative * std::abs(expected))
      << actual << " vs " << expected;
}

TEST_F(Regions, ARectangleWithACircularHoleHasExactAreas) {
  const ProfileRegions result = regionsOf(concat(rect("r", 0, 0, 10, 6), {ring("c", {5, 3}, 1.5)}));
  EXPECT_FALSE(result.crossing);
  ASSERT_EQ(result.regions.size(), 2U);
  EXPECT_EQ(result.regions[0].name, "c");
  EXPECT_EQ(result.regions[1].name, "c,r1,r2,r3,r4");
  expectExactArea(result.regions[0].area, kPi * 2.25);
  expectExactArea(result.regions[1].area, 60 - kPi * 2.25);
  ASSERT_EQ(result.regions[1].holes.size(), 1U);
  EXPECT_EQ(holeName(result.regions[1].holes[0]), "c");
  EXPECT_TRUE(result.regions[0].holes.empty());
}

TEST_F(Regions, TheSharedLineOfTwoRegionsRunsInOppositeDirections) {
  const ProfileRegions result =
      regionsOf({seg("a1", {0, 0}, {5, 0}), seg("a2", {5, 0}, {10, 0}), seg("rt", {10, 0}, {10, 5}),
                 seg("b2", {10, 5}, {5, 5}), seg("b1", {5, 5}, {0, 5}), seg("lf", {0, 5}, {0, 0}),
                 seg("m", {5, 5}, {5, 0})});
  ASSERT_EQ(result.regions.size(), 2U);
  EXPECT_EQ(result.regions[0].name, "a1,b1,lf,m");
  EXPECT_EQ(result.regions[1].name, "a2,b2,m,rt");
  for (const ProfileRegion& r : result.regions) expectExactArea(r.area, 25);
  EXPECT_EQ(*findId(result.regions[0].outer, "m"), seg("m", {5, 0}, {5, 5}));
  EXPECT_EQ(*findId(result.regions[1].outer, "m"), seg("m", {5, 5}, {5, 0}));
}

TEST_F(Regions, ASplineSideHasItsExactAreaAndTheInputSplineInTheLoop) {
  const ProfileRegions result = regionsOf(
      {seg("s1", {0, 0}, {4, 0}), seg("s2", {4, 0}, {4, 3}), kWave, seg("s4", {0, 3}, {0, 0})});
  ASSERT_EQ(result.regions.size(), 1U);
  EXPECT_EQ(result.regions[0].name, "s1,s2,s4,w");
  std::vector<Vec2> points{{0, 0}, {4, 0}};
  const std::vector<Vec2> sampled = splinePoints(kWave, 100000);
  points.insert(points.end(), sampled.begin(), sampled.end() - 1);
  points.push_back({0, 3});
  expectExactArea(result.regions[0].area, polygonArea(points), 1e-8);
  // Counter-clockwise the wave runs as drawn (4, 3) → (0, 3): the same poles and knots.
  EXPECT_EQ(*findId(result.regions[0].outer, "w"), kWave);
}

TEST_F(Regions, AClockwiseArcIsHeldCounterClockwiseInTheLoop) {
  const ProfileRegions result =
      regionsOf({seg("d1", {-2, -1}, {0, -1}), arc({0, 0}, {0, 1}, {0, -1}, false, "da"),
                 seg("d3", {0, 1}, {-2, 1}), seg("d4", {-2, 1}, {-2, -1})});
  ASSERT_EQ(result.regions.size(), 1U);
  EXPECT_EQ(result.regions[0].name, "d1,d3,d4,da");
  expectExactArea(result.regions[0].area, 4 + kPi / 2);
  EXPECT_EQ(*findId(result.regions[0].outer, "da"), arc({0, 0}, {0, -1}, {0, 1}, true, "da"));
}

TEST_F(Regions, MoreCrossingsGiveNoRegions) {
  const std::vector<std::pair<std::string, std::vector<Curve2>>> cases{
      {"two crossing lines", concat(rect("r", 0, 0, 10, 6), {seg("x", {2, -1}, {2, 7})})},
      {"an end on the inside of a line",
       concat(rect("r", 0, 0, 10, 6), {seg("t", {5, 3}, {5, 6})})},
      {"a spline crossing itself",
       {Curve2::bspline(3, {{0, 0}, {10, 6}, {-4, 6}, {6, 0}}, {0, 0, 0, 0, 1, 1, 1, 1}, "sp"),
        seg("base", {6, 0}, {0, 0})}},
      {"an end on the inside of a spline",
       {seg("s1", {0, 0}, {4, 0}), seg("s2", {4, 0}, {4, 3}),
        Curve2::bspline(1, {{4, 3}, {2, 5}, {0, 3}}, {0, 0, 0.5, 1, 1}, "w"),
        seg("s4", {0, 3}, {0, 0}), seg("t", {1, 1}, {1, 4})}},
      {"a circle tangent to a side from inside",
       concat(rect("r", 0, 0, 10, 6), {ring("c", {5, 3}, 3)})},
  };
  for (const auto& [name, curves] : cases) {
    SCOPED_TRACE(name);
    expectCrossing(regionsOf(curves));
  }
}

TEST_F(Regions, ATriangleTouchingTheRectangleOnlyInACornerIsOneLoopWithoutAHole) {
  const ProfileRegions result = regionsOf(
      concat(rect("o", 0, 0, 10, 10),
             {seg("t1", {0, 0}, {3, 1}), seg("t2", {3, 1}, {1, 3}), seg("t3", {1, 3}, {0, 0})}));
  ASSERT_EQ(result.regions.size(), 2U);
  EXPECT_EQ(result.regions[0].name, "o1,o2,o3,o4,t1,t2,t3");
  EXPECT_EQ(result.regions[1].name, "t1,t2,t3");
  EXPECT_TRUE(result.regions[0].holes.empty());
  EXPECT_EQ(result.regions[0].outer.size(), 7U);
  expectExactArea(result.regions[0].area, 96);
  expectExactArea(result.regions[1].area, 4);
}

TEST_F(Regions, ALineHangingIntoTheRectangleFromACornerBoundsNothing) {
  const ProfileRegions result = regionsOf(
      concat(rect("r", 0, 0, 10, 6), {seg("in", {0, 0}, {3, 2}), seg("out", {10, 6}, {13, 8})}));
  ASSERT_EQ(result.regions.size(), 1U);
  EXPECT_EQ(result.regions[0].name, "r1,r2,r3,r4");
  EXPECT_TRUE(result.regions[0].holes.empty());
  EXPECT_EQ(result.regions[0].outer.size(), 4U);
  expectExactArea(result.regions[0].area, 60);
}

TEST_F(Regions, AHoleWhoseContainmentRayWouldPassThroughACorner) {
  const std::vector<Curve2> diamond{seg("d1", {5, -5}, {15, 5}), seg("d2", {15, 5}, {5, 15}),
                                    seg("d3", {5, 15}, {-5, 5}), seg("d4", {-5, 5}, {5, -5})};
  const ProfileRegions result = regionsOf(concat(diamond, rect("s", 1, 1, 3, 3)));
  ASSERT_EQ(result.regions.size(), 2U);
  EXPECT_EQ(result.regions[0].name, "d1,d2,d3,d4,s1,s2,s3,s4");
  EXPECT_EQ(result.regions[1].name, "s1,s2,s3,s4");
  ASSERT_EQ(result.regions[0].holes.size(), 1U);
  EXPECT_EQ(holeName(result.regions[0].holes[0]), "s1,s2,s3,s4");
  expectExactArea(result.regions[0].area, 196);
}

TEST_F(Regions, AGridOf1860LinesTakesWellUnderASecond) {
  // M42 plan: 30 × 31 × 2 = 1860 lines under 1 s (the TS adapter takes ~110 ms).
  const int n = 30;
  std::vector<Curve2> curves;
  for (int i = 0; i <= n; ++i) {
    for (int j = 0; j < n; ++j) {
      const auto x = static_cast<double>(j);
      const auto y = static_cast<double>(i);
      curves.push_back(seg("h" + std::to_string(i) + "_" + std::to_string(j), {x, y}, {x + 1, y}));
      curves.push_back(seg("v" + std::to_string(i) + "_" + std::to_string(j), {y, x}, {y, x + 1}));
    }
  }
  ASSERT_EQ(curves.size(), 1860U);
  regionsOf(rect("w", 0, 0, 1, 1));  // warm-up
  const auto start = std::chrono::steady_clock::now();
  const ProfileRegions result = regionsOf(curves);
  const auto elapsed = std::chrono::steady_clock::now() - start;
  EXPECT_FALSE(result.crossing);
  EXPECT_EQ(result.regions.size(), static_cast<std::size_t>(n * n));
  EXPECT_LT(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count(), 1000);
}

}  // namespace
}  // namespace tinycad::kernel
