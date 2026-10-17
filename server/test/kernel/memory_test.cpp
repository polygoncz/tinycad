// The memory test of the native kernel (decision N31, M42 acceptance): 200 rounds of box,
// boolean, fillet, tessellation and release grow the resident set of the process by at most
// 20 MB after a warm-up, and no handle stays alive. Native OCCT has no capped heap like WASM, so
// only a leak is watched, not a ceiling (Q054 and Q055 were specific to the WASM build).

#include <gtest/gtest.h>
#include <unistd.h>

#include <fstream>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

/** Resident set size of this process in bytes (Linux /proc/self/statm, second field in pages). */
double residentBytes() {
  std::ifstream statm("/proc/self/statm");
  double size = 0;
  double resident = 0;
  statm >> size >> resident;
  return resident * static_cast<double>(::sysconf(_SC_PAGESIZE));
}

/** One round of modelling: everything it creates is released at its end. */
void modellingRound(OcctKernel& kernel) {
  const ShapeHandle box = ok(kernel.makeBox({{0, 0, 0}, {10, 10, 10}})).shape;
  const ShapeHandle tool = ok(kernel.makeCylinder({{5, 5, -1}, {0, 0, 1}, 2, 12})).shape;
  const ShapeHandle cut =
      ok(kernel.boolean(BooleanOp::Subtract, std::span(&box, 1), std::span(&tool, 1))).shape;
  const int edges[] = {0};
  const ShapeHandle rounded = ok(kernel.fillet(cut, edges, 1)).shape;
  const MeshData mesh = ok(kernel.tessellate(rounded, {0.05, 0.3}));
  EXPECT_FALSE(mesh.indices.empty());
  ok(kernel.release(std::vector{box, tool, cut, rounded}));
}

TEST(Memory, TwoHundredRoundsDoNotGrowTheResidentSetByMoreThan20MB) {
  OcctKernel kernel;
  for (int round = 0; round < 20; ++round) modellingRound(kernel);  // warm-up
  const double before = residentBytes();
  ASSERT_GT(before, 0);
  for (int round = 0; round < 200; ++round) modellingRound(kernel);
  const double grown = residentBytes() - before;
  EXPECT_LT(grown, 20.0 * 1024 * 1024)
      << "the resident set grew by " << grown / 1024 / 1024 << " MB";
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

}  // namespace
}  // namespace tinycad::kernel
