// The read model of one regeneration as domain data (spec 14 "Read model a sítě",
// read_model_builder.hpp): content versions, meshes by known_meshes, the input of a dialog and the
// session view. The tinycad.v1 form of it is tested in read_model_proto_test.cpp.

#include "tinycad/session/read_model_builder.hpp"

#include <gtest/gtest.h>

#include <memory>
#include <set>
#include <string>
#include <vector>

#include "session/testing.hpp"

namespace tinycad::session::test {
namespace {

/** A copy of the feature with one param changed (a new FeaturePtr, same id). */
document::FeaturePtr withParam(const document::FeaturePtr& feature, const std::string& key,
                               double value) {
  auto copy = std::make_shared<document::FeatureInstance>(*feature);
  Json params = *feature->params;
  params[key] = value;
  copy->params = std::make_shared<const Json>(std::move(params));
  return copy;
}

Json twoBoxes() {
  return aDocumentJson(Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}));
}

// ---- meshes by version -----------------------------------------------------------------------

TEST(ReadModelBuilder, TheFirstReadModelCarriesTheMeshesOfAllBodies) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto rm = s.readModel(*doc);
  ASSERT_EQ(rm.bodies.size(), 2U);
  EXPECT_EQ(bodiesWithMesh(rm.bodies), (std::vector<std::string>{"f1/body", "f2/body"}));
  const auto versions = versionsOf(rm.bodies);
  EXPECT_FALSE(versions[0].empty());
  EXPECT_NE(versions[0], versions[1]);
  EXPECT_EQ(rm.bodies[0].body->origin().str(), "f1");
  EXPECT_EQ(rm.bodies[0].body->lastModifiedBy().str(), "f1");
  EXPECT_EQ(s.kernel.calls("tessellate"), 2);
}

TEST(ReadModelBuilder, KnownMeshesWithEveryVersionGiveNoMesh) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto versions = versionsOf(s.readModel(*doc).bodies);
  const auto rm = s.readModel(*doc, optionsWith(versions));
  EXPECT_EQ(versionsOf(rm.bodies), versions);
  EXPECT_TRUE(bodiesWithMesh(rm.bodies).empty());
  // The bodies are still there with their names.
  EXPECT_EQ(rm.bodies[0].body->names()->topology().faces.size(), 6U);
}

TEST(ReadModelBuilder, AChangedParamOfOneBodyGivesItANewVersionAndOnlyItsMesh) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto before = versionsOf(s.readModel(*doc).bodies);
  // What feature.setParams does: a new f2, f1 the same pointer (the regeneration cache keys on it).
  doc->replaceFeature(withParam(doc->feature(document::FeatureId("f2")), "height", 15));
  const auto rm = s.readModel(*doc, optionsWith(before));
  const auto after = versionsOf(rm.bodies);
  EXPECT_EQ(after[0], before[0]);
  EXPECT_NE(after[1], before[1]);
  EXPECT_EQ(bodiesWithMesh(rm.bodies), std::vector<std::string>{"f2/body"});
  // The mesh cache keeps the live versions only, the new one tessellated once.
  EXPECT_EQ(s.meshes.size(), 2U);
  EXPECT_EQ(s.kernel.calls("tessellate"), 3);
}

TEST(ReadModelBuilder, ACachedMeshIsNotTessellatedAgainForAnotherClient) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  s.readModel(*doc);
  const auto rm = s.readModel(*doc);  // a client that knows nothing
  EXPECT_EQ(bodiesWithMesh(rm.bodies).size(), 2U);
  EXPECT_EQ(s.kernel.calls("tessellate"), 2);
}

TEST(ReadModelBuilder, TwoRegeneratorsGiveDifferentVersions) {
  StudioFixture a;
  StudioFixture b;
  const auto va = versionsOf(a.readModel(*a.load(twoBoxes())).bodies);
  const auto vb = versionsOf(b.readModel(*b.load(twoBoxes())).bodies);
  EXPECT_NE(va[0], vb[0]);
  EXPECT_NE(va[1], vb[1]);
}

TEST(ReadModelBuilder, TheMeshIsTheOneOfTheCache) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(Json::array({cylinderJson("f1")})));
  const auto rm = s.readModel(*doc);
  ASSERT_EQ(rm.bodies.size(), 1U);
  ASSERT_NE(rm.bodies[0].mesh, nullptr);
  const auto cached = s.meshes.mesh(rm.bodies[0].contentVersion, rm.bodies[0].body->shape(),
                                    testQuality());
  ASSERT_TRUE(cached.has_value());
  EXPECT_EQ(rm.bodies[0].mesh, *cached);
  EXPECT_EQ(s.kernel.calls("tessellate"), 1);
}

// ---- input of an open dialog -----------------------------------------------------------------

TEST(ReadModelBuilder, InputOfAFeatureBehindTheBarHasNoInput) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 1));
  const auto rm = s.readModel(*doc, optionsWith({}, "f2"));
  EXPECT_FALSE(rm.regen.input.has_value());
  EXPECT_TRUE(rm.inputBodies.empty());
  EXPECT_FALSE(s.readModel(*doc).regen.input.has_value());
}

TEST(ReadModelBuilder, InputOfAFeatureCarriesTheStateInFrontOfItWithTheSameMeshRule) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto all = s.readModel(*doc);
  const std::string f1Version = all.bodies[0].contentVersion;
  const auto rm = s.readModel(*doc, optionsWith({f1Version}, "f2"));
  ASSERT_TRUE(rm.regen.input.has_value());
  EXPECT_EQ(rm.regen.input->feature.str(), "f2");
  ASSERT_EQ(rm.inputBodies.size(), 1U);
  EXPECT_EQ(rm.inputBodies[0].body->id(), "f1/body");
  EXPECT_EQ(rm.inputBodies[0].contentVersion, f1Version);
  EXPECT_EQ(rm.inputBodies[0].mesh, nullptr);
  EXPECT_EQ(rm.regen.input->state->planes().size(), 3U);
  // The input of f1 is the empty state: origin planes and axes, no bodies.
  const auto first = s.readModel(*doc, optionsWith({}, "f1"));
  EXPECT_TRUE(first.inputBodies.empty());
  EXPECT_EQ(first.regen.input->state->axes().size(), 3U);
}

TEST(ReadModelBuilder, AnInputTheOptionsDoNotAskForIsDropped) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  regen::RunOptions run;
  run.inputOf = document::FeatureId("f2");
  const auto result = s.regenerator->run(*doc->studio(), run);
  ASSERT_TRUE(result.input.has_value());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, false, false, false,
                             std::nullopt, testQuality()};
  const auto built = s.builder.build(input, optionsWith({}, "f1"));
  ASSERT_TRUE(built.has_value());
  EXPECT_FALSE(built->regen.input.has_value());
  EXPECT_TRUE(built->inputBodies.empty());
}

TEST(ReadModelBuilder, LiveVersionsAreTheBodiesOfTheFinalStateAndOfTheInput) {
  StudioFixture s;
  auto doc = s.load(twoBoxes());
  const auto rm = s.readModel(*doc, optionsWith({}, "f2"));
  const auto final = versionsOf(rm.bodies);
  EXPECT_EQ(ReadModelBuilder::liveVersions(s.lastResult, *s.regenerator),
            (std::set<std::string>{final[0], final[1]}));
  // Behind the bar the final state has only f1; the input of f2 is not computed.
  const auto rolled =
      s.load(aDocumentJson(Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 1));
  s.readModel(*rolled);
  EXPECT_EQ(ReadModelBuilder::liveVersions(s.lastResult, *s.regenerator).size(), 1U);
}

// ---- document, regeneration, session ---------------------------------------------------------

TEST(ReadModelBuilder, DocumentAndRegenerationAreSharedNotCopiedOutOfTheRuntime) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto rm = s.readModel(*doc);
  EXPECT_EQ(rm.meta.id.str(), "doc-1");
  EXPECT_EQ(rm.meta.name, "Part 1");
  EXPECT_EQ(rm.studio, doc->studio());
  EXPECT_EQ(rm.lastSeq, 7);
  EXPECT_EQ(rm.regen.finalState, s.lastResult.finalState);
  EXPECT_EQ(rm.regen.statuses.size(), 2U);
  // The bodies are those of the final state, in its order.
  ASSERT_EQ(rm.bodies.size(), rm.regen.finalState->bodies().size());
  for (std::size_t i = 0; i < rm.bodies.size(); ++i) {
    EXPECT_EQ(rm.bodies[i].body, rm.regen.finalState->bodies()[i]);
  }
}

TEST(ReadModelBuilder, GenerationAndSessionComeFromTheInput) {
  StudioFixture s;
  const auto rm = s.readModel(*s.load(twoBoxes()));
  EXPECT_EQ(rm.generation, 3U);
  EXPECT_TRUE(rm.session.writable);
  EXPECT_TRUE(rm.session.canUndo);
  EXPECT_FALSE(rm.session.canRedo);
  ASSERT_TRUE(rm.session.transactionLabel.has_value());
  EXPECT_EQ(*rm.session.transactionLabel, "Box 1: height");
}

TEST(ReadModelBuilder, NoTransactionMeansNoTransactionLabel) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto result = s.regenerator->run(*doc->studio());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, false, false, false,
                             std::nullopt, testQuality()};
  const auto built = s.builder.build(input, {});
  ASSERT_TRUE(built.has_value());
  EXPECT_FALSE(built->session.transactionLabel.has_value());
  EXPECT_FALSE(built->session.writable);
}

TEST(ReadModelBuilder, AMeshThatFailsToTessellateIsAnInternalError) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto result = s.regenerator->run(*doc->studio());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, true, false, false,
                             std::nullopt, testQuality()};
  s.kernel.failNext("tessellate", kernel::KernelError{kernel::KernelErrorCode::Internal, "x"});
  const auto built = s.builder.build(input, {});
  ASSERT_FALSE(built.has_value());
  EXPECT_EQ(built.error().reason, ErrorReason::Internal);
}

}  // namespace
}  // namespace tinycad::session::test
