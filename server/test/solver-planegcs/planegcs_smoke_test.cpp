// A smoke test of the vendored planegcs (M44 task 2): the library builds and solves through the
// GcsSystem API the WASM wrapper drives, without the tinycad adapter.

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <vector>

#include "gcs_system.h"

namespace {

using planegcs::GcsSystem;

constexpr int kNoDebug = 0;
constexpr int kDogLeg = 2;
constexpr int kSuccess = 0;

/** The p-params of a point [x, y]; returns the index of x. */
int pushPoint(GcsSystem& gcs, double x, double y) {
  const int at = gcs.push_p_param(x, false);
  gcs.push_p_param(y, false);
  return at;
}

/** Releases the params of the system at the end of a test, like destroy_gcs_module. */
struct Cleared {
  GcsSystem& gcs;
  ~Cleared() { gcs.clear_data(); }
};

TEST(PlanegcsSmoke, SolvesADistanceBetweenAFixedAndAFreePoint) {
  GcsSystem gcs;
  const Cleared cleared{gcs};
  gcs.set_debug_mode(kNoDebug);
  const int a = pushPoint(gcs, 0, 0);
  const int b = pushPoint(gcs, 3, 1);
  GCS::Point pa = gcs.make_point(a, a + 1);
  GCS::Point pb = gcs.make_point(b, b + 1);

  // a fixed at the origin by two coordinates, b on the x axis 10 away.
  gcs.add_constraint_coordinate_x(pa, gcs.push_p_param(0, true), 1, true);
  gcs.add_constraint_coordinate_y(pa, gcs.push_p_param(0, true), 2, true);
  gcs.add_constraint_horizontal_pp(pa, pb, 3, true);
  gcs.add_constraint_p2p_distance(pa, pb, gcs.push_p_param(10, true), 4, true);

  EXPECT_EQ(gcs.solve_system(kDogLeg), kSuccess);
  gcs.apply_solution();
  EXPECT_EQ(gcs.dof(), 0);
  EXPECT_NEAR(gcs.get_p_param(b), 10, 1e-9);
  EXPECT_NEAR(gcs.get_p_param(b + 1), 0, 1e-9);
  EXPECT_FALSE(gcs.has_conflicting());
}

TEST(PlanegcsSmoke, ReportsConflictingConstraintsByTag) {
  GcsSystem gcs;
  const Cleared cleared{gcs};
  gcs.set_debug_mode(kNoDebug);
  const int a = pushPoint(gcs, 0, 0);
  const int b = pushPoint(gcs, 3, 0);
  GCS::Point pa = gcs.make_point(a, a + 1);
  GCS::Point pb = gcs.make_point(b, b + 1);

  gcs.add_constraint_coordinate_x(pa, gcs.push_p_param(0, true), 1, true);
  gcs.add_constraint_coordinate_y(pa, gcs.push_p_param(0, true), 2, true);
  gcs.add_constraint_horizontal_pp(pa, pb, 3, true);
  // Two different distances between the same points: they cannot hold together.
  gcs.add_constraint_p2p_distance(pa, pb, gcs.push_p_param(10, true), 4, true);
  gcs.add_constraint_p2p_distance(pa, pb, gcs.push_p_param(20, true), 5, true);

  gcs.solve_system(kDogLeg);
  ASSERT_TRUE(gcs.has_conflicting());
  const std::vector<int> conflicting = gcs.get_conflicting();
  EXPECT_NE(std::find(conflicting.begin(), conflicting.end(), 5), conflicting.end());
}

}  // namespace
