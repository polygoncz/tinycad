// The input of the feature of an open dialog (ADR 0025; port of
// test/unit/regen/regenerator-input.test.ts).

#include <gtest/gtest.h>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

RunOptions inputOf(const std::string& id) { return RunOptions{fid(id)}; }

TEST(RegeneratorInput, IsTheStateAfterThePreviousFeatureForAFeatureInTheMiddle) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(3)), inputOf("f2"));
  ASSERT_TRUE(r.input.has_value());
  EXPECT_EQ(r.input->feature.str(), "f2");
  // The builder of f2 got the very same state as its input.
  EXPECT_EQ(r.input->state, s.box->inputStates()[1]);
  ASSERT_EQ(r.input->state->bodies().size(), 1U);
  EXPECT_EQ(r.input->state->bodies()[0]->id(), "f1/body");
}

TEST(RegeneratorInput, IsTheEmptyStateForTheFirstFeature) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(3)), inputOf("f1"));
  ASSERT_TRUE(r.input.has_value());
  EXPECT_EQ(r.input->state, RegenState::empty());
}

TEST(RegeneratorInput, IsTheInputOfTheFeatureRightInFrontOfTheRollbackBar) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(3), 2), inputOf("f2"));
  ASSERT_TRUE(r.input.has_value());
  EXPECT_EQ(r.input->state, s.box->inputStates()[1]);
}

TEST(RegeneratorInput, ExistsForASuppressedFeatureAndForAFeatureInError) {
  RegenSetup s;
  auto fs = features(3);
  fs[1] = suppressedCopy(fs[1]);
  fs[2] = resized(fs[2], -1);
  const auto studio = aStudio(fs);
  const auto r2 = s.regenerator->run(studio, inputOf("f2"));
  EXPECT_EQ(statusOf(r2, "f2").kind, FeatureStatusKind::Suppressed);
  const auto r3 = s.regenerator->run(studio, inputOf("f3"));
  EXPECT_EQ(statusOf(r3, "f3").kind, FeatureStatusKind::Error);
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f1"});
  EXPECT_EQ(r2.input->state, r2.finalState);
  EXPECT_EQ(r3.input->state, r2.finalState);
}

TEST(RegeneratorInput, IsAbsentBehindTheBarForAnUnknownFeatureAndWithoutInputOf) {
  RegenSetup s;
  const auto fs = features(3);
  EXPECT_FALSE(s.regenerator->run(aStudio(fs, 1), inputOf("f2")).input.has_value());
  EXPECT_FALSE(s.regenerator->run(aStudio(fs), inputOf("nope")).input.has_value());
  EXPECT_FALSE(s.regenerator->run(aStudio(fs)).input.has_value());
}

TEST(RegeneratorInput, ExistsForACachedFeature) {
  RegenSetup s;
  const auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  const StatePtr f3Input = s.box->inputStates()[2];
  const auto r = s.regenerator->run(aStudio(fs), inputOf("f3"));
  EXPECT_EQ(s.box->callCount(), 3);
  EXPECT_EQ(r.input->state, f3Input);
}

TEST(RegeneratorInput, KeepsTheHandlesOfTheInputAliveAfterTheSweep) {
  RegenSetup s;
  auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  fs[2] = resized(fs[2], 2);
  const auto r = s.regenerator->run(aStudio(fs, 3), inputOf("f3"));
  EXPECT_EQ(s.kernel.calls("release"), 1);
  EXPECT_EQ(s.kernel.liveHandleCount(), 3U);
  const auto bodies = r.input->state->bodies();
  ASSERT_EQ(bodies.size(), 2U);
  for (const auto& b : bodies) EXPECT_TRUE(s.kernel.boundingBox(b->shape()));
}

}  // namespace
}  // namespace tinycad::regen::test
