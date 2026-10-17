// Anchors of manipulators (spec 07 "Kotvy manipulátorů", M18; port of
// test/unit/regen/regenerator-anchors.test.ts): the Regenerator keeps the anchors a builder
// returned in its cache and in RegenResult.anchors.

#include <gtest/gtest.h>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

/** buildCube plus the anchor 'pivot' at [size, 0, 0] pointing along +Z. */
BuildResult buildWithAnchors(const BuildInput& input, BuildContext& ctx) {
  auto out = buildCube(input, ctx);
  if (!out) return out;
  const double size = input.params.at("size").get<double>();
  out->anchors["pivot"] = Anchor{{size, 0, 0}, core::Vec3{0, 0, 1}};
  return out;
}

const FeatureAnchors* anchorsOf(const RegenResult& r, const std::string& id) {
  for (const auto& [feature, anchors] : r.anchors) {
    if (feature.str() == id) return &anchors;
  }
  return nullptr;
}

std::vector<std::string> anchoredIds(const RegenResult& r) {
  std::vector<std::string> ids;
  for (const auto& [feature, anchors] : r.anchors) ids.push_back(feature.str());
  return ids;
}

TEST(RegeneratorAnchors, PutsTheAnchorsOfABuilderUnderTheFeatureId) {
  RegenSetup s(buildWithAnchors);
  const auto r = s.regenerator->run(aStudio({aFeature("f1", 2)}));
  ASSERT_NE(anchorsOf(r, "f1"), nullptr);
  EXPECT_EQ(*anchorsOf(r, "f1"),
            (FeatureAnchors{{"pivot", Anchor{{2, 0, 0}, core::Vec3{0, 0, 1}}}}));
}

TEST(RegeneratorAnchors, KeepsTheAnchorsOfAFeatureTakenFromTheCache) {
  RegenSetup s(buildWithAnchors);
  const auto studio = aStudio({aFeature("f1", 3)});
  s.regenerator->run(studio);
  s.box->reset();
  const auto r = s.regenerator->run(studio);
  EXPECT_EQ(s.box->callCount(), 0);
  ASSERT_NE(anchorsOf(r, "f1"), nullptr);
  EXPECT_EQ(anchorsOf(r, "f1")->at("pivot").point, (core::Vec3{3, 0, 0}));
}

TEST(RegeneratorAnchors, KeepsTheAnchorsOfAFeatureWithAWarning) {
  RegenSetup s([](const BuildInput& input, BuildContext& ctx) {
    ctx.warn("careful");
    return buildWithAnchors(input, ctx);
  });
  const auto r = s.regenerator->run(aStudio({aFeature("f1")}));
  EXPECT_EQ(statusOf(r, "f1").kind, FeatureStatusKind::Warning);
  EXPECT_NE(anchorsOf(r, "f1"), nullptr);
}

TEST(RegeneratorAnchors, LeavesOutFailedSuppressedAndRolledBackFeatures) {
  RegenSetup s(buildWithAnchors);
  const auto r = s.regenerator->run(aStudio(
      {aFeature("f1"), aFeature("bad", 0), suppressedCopy(aFeature("off")), aFeature("late")}, 3));
  EXPECT_EQ(anchoredIds(r), std::vector<std::string>{"f1"});
}

TEST(RegeneratorAnchors, KeepsTheEmptyAnchorsOfAFeatureWithoutAManipulator) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio({aFeature("f1")}));
  ASSERT_NE(anchorsOf(r, "f1"), nullptr);
  EXPECT_TRUE(anchorsOf(r, "f1")->empty());
}

TEST(RegeneratorAnchors, LeavesOutACachedFeatureThatMovedBehindTheRollbackBar) {
  RegenSetup s(buildWithAnchors);
  const auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  const auto r = s.regenerator->run(aStudio(fs, 1));
  EXPECT_EQ(anchoredIds(r), std::vector<std::string>{"f1"});
}

TEST(RegeneratorAnchors, BringsTheAnchorsBackOnceAFailedFeatureIsFixed) {
  RegenSetup s(buildWithAnchors);
  const auto broken = aFeature("f1", 0);
  EXPECT_TRUE(s.regenerator->run(aStudio({broken})).anchors.empty());
  const auto r = s.regenerator->run(aStudio({resized(broken, 4)}));
  ASSERT_NE(anchorsOf(r, "f1"), nullptr);
  EXPECT_EQ(anchorsOf(r, "f1")->at("pivot").point, (core::Vec3{4, 0, 0}));
}

}  // namespace
}  // namespace tinycad::regen::test
