// The mesh cache of a runtime document (N60, read_model_builder.hpp).

#include <gtest/gtest.h>

#include <set>
#include <stdexcept>
#include <string>

#include "regen/testing.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/session/read_model_builder.hpp"

namespace tinycad::session {
namespace {

using regen::test::CountingKernel;

kernel::ShapeHandle aBox(CountingKernel& kernel, double size = 10) {
  auto box = kernel.occt().makeBox(kernel::BoxInput{{0, 0, 0}, {size, size, size}});
  if (!box) throw std::runtime_error(box.error().message);
  return box->shape;
}

const kernel::MeshQuality kFine{0.1, 0.5};
const kernel::MeshQuality kCoarse{1, 0.5};

TEST(MeshCache, TessellatesAVersionOnceAndSharesTheMesh) {
  CountingKernel kernel;
  MeshCache cache(kernel);
  const auto shape = aBox(kernel);
  const auto first = cache.mesh("p.1", shape, kFine);
  const auto second = cache.mesh("p.1", shape, kFine);
  ASSERT_TRUE(first.has_value());
  ASSERT_TRUE(second.has_value());
  EXPECT_EQ(*first, *second);
  EXPECT_EQ(kernel.calls("tessellate"), 1);
  EXPECT_EQ(cache.size(), 1U);
  EXPECT_FALSE((*first)->positions.empty());
}

TEST(MeshCache, KeysByVersionAndQuality) {
  CountingKernel kernel;
  MeshCache cache(kernel);
  const auto shape = aBox(kernel);
  ASSERT_TRUE(cache.mesh("p.1", shape, kFine).has_value());
  ASSERT_TRUE(cache.mesh("p.1", shape, kCoarse).has_value());
  ASSERT_TRUE(cache.mesh("p.2", shape, kFine).has_value());
  EXPECT_EQ(kernel.calls("tessellate"), 3);
  EXPECT_EQ(cache.size(), 3U);
}

TEST(MeshCache, RetainDropsEveryQualityOfTheDeadVersions) {
  CountingKernel kernel;
  MeshCache cache(kernel);
  const auto shape = aBox(kernel);
  ASSERT_TRUE(cache.mesh("p.1", shape, kFine).has_value());
  ASSERT_TRUE(cache.mesh("p.1", shape, kCoarse).has_value());
  ASSERT_TRUE(cache.mesh("p.2", shape, kFine).has_value());
  cache.retain({"p.2"});
  EXPECT_EQ(cache.size(), 1U);
  ASSERT_TRUE(cache.mesh("p.2", shape, kFine).has_value());
  EXPECT_EQ(kernel.calls("tessellate"), 3);  // p.2 still cached
  ASSERT_TRUE(cache.mesh("p.1", shape, kFine).has_value());
  EXPECT_EQ(kernel.calls("tessellate"), 4);  // p.1 tessellated again
}

TEST(MeshCache, ReturnsTheKernelErrorAndCachesNothing) {
  CountingKernel kernel;
  MeshCache cache(kernel);
  const auto shape = aBox(kernel);
  kernel.failNext("tessellate", kernel::KernelError{kernel::KernelErrorCode::Internal, "boom"});
  const auto failed = cache.mesh("p.1", shape, kFine);
  ASSERT_FALSE(failed.has_value());
  EXPECT_EQ(failed.error().code, kernel::KernelErrorCode::Internal);
  EXPECT_EQ(cache.size(), 0U);
  EXPECT_TRUE(cache.mesh("p.1", shape, kFine).has_value());
}

}  // namespace
}  // namespace tinycad::session
