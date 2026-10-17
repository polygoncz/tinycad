// Lifetime of handles: mark & sweep (spec 07 "Životnost handle") and failures of release (Q040);
// port of test/unit/regen/regenerator-sweep.test.ts without concurrency and the lost kernel (N40).

#include <gtest/gtest.h>

#include <stdexcept>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/origin.hpp"

namespace tinycad::regen::test {
namespace {

void registerType(RegenSetup& s, const std::string& type, SpyBuilder::Build build) {
  s.schemas.add(aSchema(type));
  s.builders.add(std::make_shared<SpyBuilder>(type, std::move(build)));
}

/** A square region of side `size` on XY with its corner at the origin. */
kernel::FaceInput aSquare(double size) {
  const std::vector<core::Vec2> c{{0, 0}, {size, 0}, {size, size}, {0, size}};
  kernel::ProfileLoop outer;
  for (std::size_t i = 0; i < 4; ++i) outer.push_back(core::Curve2::line(c[i], c[(i + 1) % 4]));
  return {document::ORIGIN_PLANES[0].plane, outer, {}};
}

/** A test sketch builder: the sketch artifact of the feature with two region faces. */
BuildResult buildTwoFaceSketch(const BuildInput& input, BuildContext& ctx) {
  std::vector<ShapeHandle> faces;
  for (double size : {1.0, 2.0}) {
    auto face = ctx.kernel().makeFace(aSquare(size));
    if (!face) return core::fail(kernelFailure(face.error()));
    faces.push_back(face->shape);
  }
  return BuildOutput{input.state->with(aSketchArtifact(input.feature.id.str(), faces)), {}};
}

/** Creates an intermediate shape and fails. */
BuildResult buildScrapAndFail(const BuildInput&, BuildContext& ctx) {
  (void)ctx.kernel().makeBox({{0, 0, 0}, {1, 1, 1}});
  return core::fail(FeatureError{FeatureErrorCode::InvalidParams, "scrap", {}});
}

TEST(RegeneratorSweep, AChangedParamReleasesTheOldBodyOnlyLiveHandlesRemain) {
  RegenSetup s;
  auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  fs[1] = resized(fs[1], 2);
  const auto r = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
  EXPECT_EQ(s.regenerator->ownedHandleCount(), 2U);
  for (const auto& b : r.finalState->bodies()) EXPECT_TRUE(s.kernel.boundingBox(b->shape()));
}

TEST(RegeneratorSweep, DeletingAFeatureReleasesItsBodyAndTheRebuiltBodiesAfterIt) {
  RegenSetup s;
  const auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  s.regenerator->run(aStudio({fs[0], fs[2]}));
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
}

TEST(RegeneratorSweep, ReleasesAllDeadHandlesInOneCallAndSkipsReleaseWhenNoneIsDead) {
  RegenSetup s;
  const auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.kernel.calls("release"), 0);
  const std::vector<FeaturePtr> rest(fs.begin() + 1, fs.end());
  s.regenerator->run(aStudio(rest));
  EXPECT_EQ(s.kernel.calls("release"), 1);
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
  s.regenerator->run(aStudio(rest));
  EXPECT_EQ(s.kernel.calls("release"), 1);
}

TEST(RegeneratorSweep, KeepsTheHandlesOfCacheEntriesBehindTheRollbackBar) {
  RegenSetup s;
  const auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  s.regenerator->run(aStudio(fs, 1));
  EXPECT_EQ(s.kernel.calls("release"), 0);
  EXPECT_EQ(s.kernel.liveHandleCount(), 3U);
}

TEST(RegeneratorSweep, KeepsTheRegionFacesOfASketchAliveAndReleasesThemWhenItIsRemoved) {
  RegenSetup s;
  registerType(s, "sketch", buildTwoFaceSketch);
  const auto r = s.regenerator->run(aStudio({aFeature("s", 1, "sketch")}));
  EXPECT_EQ(s.kernel.calls("makeFace"), 2);
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
  for (const auto& region : r.finalState->sketches().at(0)->regions) {
    EXPECT_TRUE(s.kernel.boundingBox(region.face));
  }
  s.regenerator->run(aStudio({}));
  EXPECT_EQ(s.kernel.liveHandleCount(), 0U);
}

TEST(RegeneratorSweep, ARebuiltSketchReleasesItsOldRegionFacesAndKeepsTheNewOnes) {
  RegenSetup s;
  registerType(s, "sketch", buildTwoFaceSketch);
  const auto sketch = aFeature("s", 1, "sketch");
  s.regenerator->run(aStudio({sketch}));
  s.regenerator->run(aStudio({std::make_shared<const document::FeatureInstance>(*sketch),
                              aFeature("f1")}));
  EXPECT_EQ(s.kernel.calls("makeFace"), 4);
  EXPECT_EQ(s.kernel.calls("release"), 1);
  EXPECT_EQ(s.kernel.liveHandleCount(), 3U);
}

TEST(RegeneratorSweep, ABuilderThatCreatesAnIntermediateShapeAndFailsLeaksNothing) {
  RegenSetup s;
  registerType(s, "scrap", buildScrapAndFail);
  const auto r = s.regenerator->run(aStudio({aFeature("a"), aFeature("b", 1, "scrap")}));
  EXPECT_EQ(statusOf(r, "b").kind, FeatureStatusKind::Error);
  EXPECT_EQ(s.kernel.liveHandleCount(), 1U);
}

TEST(RegeneratorSweep, ANonKernelExceptionLeavesRunAndItsHandlesAreReleasedAnyway) {
  RegenSetup s;
  registerType(s, "buggy", [](const BuildInput&, BuildContext& ctx) -> BuildResult {
    (void)ctx.kernel().makeBox({{0, 0, 0}, {1, 1, 1}});
    throw std::logic_error("plugin bug");
  });
  const auto a = aFeature("a");
  s.regenerator->run(aStudio({a}));
  EXPECT_THROW(s.regenerator->run(aStudio({a, aFeature("x"), aFeature("y", 1, "buggy")})),
               std::logic_error);
  // The cache still holds the first run (one body); x and the scrap of y are dead.
  EXPECT_EQ(s.kernel.liveHandleCount(), 1U);
  EXPECT_EQ(s.regenerator->ownedHandleCount(), 1U);
}

TEST(RegeneratorSweep, AfterASequenceOfChangesTheLiveHandlesAreTheOwnedOnes) {
  RegenSetup s;
  auto fs = features(4);
  s.regenerator->run(aStudio(fs));
  fs[1] = resized(fs[1], 3);
  s.regenerator->run(aStudio(fs, 2));
  fs.erase(fs.begin());
  s.regenerator->run(aStudio(fs));
  fs[0] = suppressedCopy(fs[0]);
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.kernel.liveHandleCount(), s.regenerator->ownedHandleCount());
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
}

TEST(RegeneratorSweep, DestroyingTheRegeneratorReleasesEveryOwnedHandle) {
  CountingKernel kernel;
  {
    document::FeatureSchemaRegistry schemas;
    schemas.add(aSchema());
    FeatureBuilderRegistry builders;
    builders.add(std::make_shared<CubeBuilder>());
    Regenerator regenerator(kernel, builders, schemas, stoppedClock);
    regenerator.run(aStudio(features(3)));
    EXPECT_EQ(kernel.liveHandleCount(), 3U);
  }
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

// --- release failures (Q040)

TEST(RegeneratorReleaseFailures, UnknownHandleLeavesRunWithAnAssertionAndTheHandlesStayOwned) {
  RegenSetup s;
  const auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  s.kernel.failNext("release", {kernel::KernelErrorCode::UnknownHandle, "unknown"});
  EXPECT_THROW(s.regenerator->run(aStudio({fs[1]})), core::AssertionError);
  // Old f1 and f2 plus the new f2 stay owned.
  EXPECT_EQ(s.regenerator->ownedHandleCount(), 3U);
}

TEST(RegeneratorReleaseFailures, AnotherKernelErrorKeepsTheHandlesAndTheNextSweepReleasesThem) {
  RegenSetup s;
  const auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  s.kernel.failNext("release", {kernel::KernelErrorCode::Internal, "boom"});
  const auto r = s.regenerator->run(aStudio({fs[1]}));
  EXPECT_EQ(statusOf(r, "f2").kind, FeatureStatusKind::Ok);
  // Old f1 and f2 are still alive in the kernel.
  EXPECT_EQ(s.kernel.liveHandleCount(), 3U);
  s.regenerator->run(aStudio({fs[1]}));
  EXPECT_EQ(s.kernel.liveHandleCount(), 1U);
  EXPECT_EQ(s.kernel.calls("release"), 2);
}

TEST(RegeneratorReleaseFailures, AfterANonKernelExceptionTheOriginalExceptionWins) {
  RegenSetup s;
  registerType(s, "buggy", [](const BuildInput&, BuildContext& ctx) -> BuildResult {
    (void)ctx.kernel().makeBox({{0, 0, 0}, {1, 1, 1}});
    throw std::logic_error("plugin bug");
  });
  s.kernel.failNext("release", {kernel::KernelErrorCode::UnknownHandle, "unknown"});
  EXPECT_THROW(s.regenerator->run(aStudio({aFeature("y", 1, "buggy")})), std::logic_error);
}

}  // namespace
}  // namespace tinycad::regen::test
