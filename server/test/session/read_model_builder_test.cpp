// The read model of one regeneration (spec 14 "Read model a sítě", read_model_builder.hpp).

#include "tinycad/session/read_model_builder.hpp"

#include <gtest/gtest.h>

#include <bit>
#include <memory>
#include <set>
#include <stdexcept>
#include <cstdint>
#include <string>
#include <vector>

#include "session/testing.hpp"

namespace tinycad::session::test {
namespace {

namespace v1 = tinycad::v1;

/** Little-endian 32-bit words of the wire → values. */
std::vector<std::uint32_t> wordsOf(const std::string& bytes) {
  EXPECT_EQ(bytes.size() % 4, 0U);
  std::vector<std::uint32_t> out;
  for (std::size_t i = 0; i + 4 <= bytes.size(); i += 4) {
    std::uint32_t word = 0;
    for (std::size_t b = 0; b < 4; ++b) {
      word |= static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[i + b])) << (8 * b);
    }
    out.push_back(word);
  }
  return out;
}

std::vector<float> floatsOf(const std::string& bytes) {
  std::vector<float> out;
  for (std::uint32_t word : wordsOf(bytes)) out.push_back(std::bit_cast<float>(word));
  return out;
}

/** A copy (a reference would trip -Wdangling-reference over the temporary id). */
v1::BodyView bodyNamed(const v1::StateView& state, const std::string& id) {
  for (const auto& body : state.bodies()) {
    if (body.body_id() == id) return body;
  }
  throw std::runtime_error("no body " + id);
}

/** The index of the face whose primary name contains `part`; throws when there is none. */
std::uint32_t faceWith(const v1::BodyView& body, const std::string& part) {
  for (int i = 0; i < body.face_names_size(); ++i) {
    if (body.face_names(i).find(part) != std::string::npos) return static_cast<std::uint32_t>(i);
  }
  throw std::runtime_error("no face " + part);
}

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
  const auto& final = rm.regen().final();
  ASSERT_EQ(final.bodies_size(), 2);
  EXPECT_EQ(bodiesWithMesh(final), (std::vector<std::string>{"f1/body", "f2/body"}));
  const auto versions = versionsOf(final);
  EXPECT_FALSE(versions[0].empty());
  EXPECT_NE(versions[0], versions[1]);
  EXPECT_EQ(final.bodies(0).origin(), "f1");
  EXPECT_EQ(final.bodies(0).last_modified_by(), "f1");
  EXPECT_EQ(s.kernel.calls("tessellate"), 2);
}

TEST(ReadModelBuilder, KnownMeshesWithEveryVersionGiveNoMesh) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto versions = versionsOf(s.readModel(*doc).regen().final());
  const auto rm = s.readModel(*doc, optionsWith(versions));
  EXPECT_EQ(versionsOf(rm.regen().final()), versions);
  EXPECT_TRUE(bodiesWithMesh(rm.regen().final()).empty());
  // The bodies are still there with their names.
  EXPECT_EQ(rm.regen().final().bodies(0).face_names_size(), 6);
}

TEST(ReadModelBuilder, AChangedParamOfOneBodyGivesItANewVersionAndOnlyItsMesh) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto before = versionsOf(s.readModel(*doc).regen().final());
  // What feature.setParams does: a new f2, f1 the same pointer (the regeneration cache keys on it).
  doc->replaceFeature(withParam(doc->feature(document::FeatureId("f2")), "height", 15));
  const auto rm = s.readModel(*doc, optionsWith(before));
  const auto after = versionsOf(rm.regen().final());
  EXPECT_EQ(after[0], before[0]);
  EXPECT_NE(after[1], before[1]);
  EXPECT_EQ(bodiesWithMesh(rm.regen().final()), std::vector<std::string>{"f2/body"});
  // The mesh cache keeps the live versions only, the new one tessellated once.
  EXPECT_EQ(s.meshes.size(), 2U);
  EXPECT_EQ(s.kernel.calls("tessellate"), 3);
}

TEST(ReadModelBuilder, ACachedMeshIsNotTessellatedAgainForAnotherClient) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  s.readModel(*doc);
  const auto rm = s.readModel(*doc);  // a client that knows nothing
  EXPECT_EQ(bodiesWithMesh(rm.regen().final()).size(), 2U);
  EXPECT_EQ(s.kernel.calls("tessellate"), 2);
}

TEST(ReadModelBuilder, TwoRegeneratorsGiveDifferentVersions) {
  StudioFixture a;
  StudioFixture b;
  const auto va = versionsOf(a.readModel(*a.load(twoBoxes())).regen().final());
  const auto vb = versionsOf(b.readModel(*b.load(twoBoxes())).regen().final());
  EXPECT_NE(va[0], vb[0]);
  EXPECT_NE(va[1], vb[1]);
}

TEST(ReadModelBuilder, MeshBytesDecodeBackToTheMeshDataWithoutLoss) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(Json::array({cylinderJson("f1")})));
  const auto rm = s.readModel(*doc);
  const auto& body = rm.regen().final().bodies(0);
  ASSERT_TRUE(body.has_mesh());
  const auto expected = s.kernel.occt().tessellate(s.lastResult.finalState->bodies()[0]->shape(),
                                                   testQuality());
  ASSERT_TRUE(expected.has_value());
  EXPECT_EQ(floatsOf(body.mesh().positions()), expected->positions);
  EXPECT_EQ(floatsOf(body.mesh().normals()), expected->normals);
  EXPECT_EQ(wordsOf(body.mesh().indices()), expected->indices);
  EXPECT_EQ(wordsOf(body.mesh().face_ranges()), expected->faceRanges);
  EXPECT_EQ(floatsOf(body.mesh().edge_positions()), expected->edgePositions);
  EXPECT_EQ(wordsOf(body.mesh().edge_ranges()), expected->edgeRanges);
}

// ---- input of an open dialog -----------------------------------------------------------------

TEST(ReadModelBuilder, InputOfAFeatureBehindTheBarHasNoInput) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 1));
  const auto rm = s.readModel(*doc, optionsWith({}, "f2"));
  EXPECT_FALSE(rm.regen().has_input());
  EXPECT_FALSE(s.readModel(*doc).regen().has_input());
}

TEST(ReadModelBuilder, InputOfAFeatureCarriesTheStateInFrontOfItWithTheSameMeshRule) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto all = s.readModel(*doc);
  const std::string f1Version = all.regen().final().bodies(0).content_version();
  const auto rm = s.readModel(*doc, optionsWith({f1Version}, "f2"));
  ASSERT_TRUE(rm.regen().has_input());
  EXPECT_EQ(rm.regen().input().feature_id(), "f2");
  const auto& input = rm.regen().input().state();
  ASSERT_EQ(input.bodies_size(), 1);
  EXPECT_EQ(input.bodies(0).body_id(), "f1/body");
  EXPECT_EQ(input.bodies(0).content_version(), f1Version);
  EXPECT_FALSE(input.bodies(0).has_mesh());
  EXPECT_EQ(input.planes_size(), 3);
  // The input of f1 is the empty state: origin planes and axes, no bodies.
  const auto first = s.readModel(*doc, optionsWith({}, "f1"));
  EXPECT_EQ(first.regen().input().state().bodies_size(), 0);
  EXPECT_EQ(first.regen().input().state().axes_size(), 3);
}

TEST(ReadModelBuilder, LiveVersionsAreTheBodiesOfTheFinalStateAndOfTheInput) {
  StudioFixture s;
  auto doc = s.load(twoBoxes());
  const auto rm = s.readModel(*doc, optionsWith({}, "f2"));
  const auto final = versionsOf(rm.regen().final());
  EXPECT_EQ(ReadModelBuilder::liveVersions(s.lastResult, *s.regenerator),
            (std::set<std::string>{final[0], final[1]}));
  // Behind the bar the final state has only f1; the input of f2 is not computed.
  const auto rolled =
      s.load(aDocumentJson(Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 1));
  s.readModel(*rolled);
  EXPECT_EQ(ReadModelBuilder::liveVersions(s.lastResult, *s.regenerator).size(), 1U);
}

// ---- names and planes of faces ---------------------------------------------------------------

TEST(ReadModelBuilder, FaceAndEdgeNamesArePrimaryNamesByIndex) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(Json::array({boxJson("f1", {0, 0, 0})})));
  const auto rm = s.readModel(*doc);
  const auto& body = rm.regen().final().bodies(0);
  const auto& names = *s.lastResult.finalState->bodies()[0]->names();
  ASSERT_EQ(body.face_names_size(), 6);
  ASSERT_EQ(body.edge_names_size(), 12);
  for (int i = 0; i < 6; ++i) EXPECT_EQ(body.face_names(i), names.nameOfFace(i)->str());
  for (int i = 0; i < 12; ++i) {
    const auto name = names.nameOfEdge(i);
    EXPECT_EQ(body.edge_names(i), name ? name->str() : "");
  }
}

TEST(ReadModelBuilder, TheTopFaceOfABoxHasItsPlaneAndACylindricalFaceHasNone) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}, 10, 7), cylinderJson("f2", 5, 10)})));
  const auto rm = s.readModel(*doc);
  const auto box = bodyNamed(rm.regen().final(), "f1/body");
  EXPECT_EQ(box.face_planes_size(), 6);
  const auto top = box.face_planes().at(faceWith(box, "face:top"));
  EXPECT_NEAR(top.origin().z(), 7, 1e-9);
  EXPECT_NEAR(top.normal().z(), 1, 1e-9);
  EXPECT_NEAR(top.x_dir().x(), 1, 1e-9);

  const auto cylinder = bodyNamed(rm.regen().final(), "f2/body");
  ASSERT_EQ(cylinder.face_names_size(), 3);
  EXPECT_EQ(cylinder.face_planes_size(), 2);
  const std::uint32_t side = faceWith(cylinder, "face:side");
  EXPECT_FALSE(cylinder.face_planes().contains(side));
}

// ---- sketches, planes, axes ------------------------------------------------------------------

TEST(ReadModelBuilder, ASketchCarriesItsEntitiesThenTheDerivedOnesAndTheRegionsWithOutlines) {
  StudioFixture s;
  const Json entities = Json::array({Json{{"id", "l1"}, {"kind", "line"}},
                                     Json{{"id", "t1"}, {"kind", "text"}, {"text", "Hi"}}});
  const Json derived = Json::array({Json{{"id", "p1#1"}, {"kind", "line"}},
                                    Json{{"id", "t1#H"}, {"kind", "bspline"}, {"degree", 3}}});
  const auto doc = s.load(aDocumentJson(Json::array(
      {aFeatureJson("s1", "testSketch", Json{{"entities", entities}, {"derived", derived}})})));
  const auto rm = s.readModel(*doc);
  const auto& final = rm.regen().final();
  ASSERT_EQ(final.sketches_size(), 1);
  const auto& sketch = final.sketches(0);
  EXPECT_EQ(sketch.sketch_id(), "s1/sketch");
  EXPECT_EQ(sketch.feature_id(), "s1");
  EXPECT_EQ(sketch.plane().normal().z(), 1);
  EXPECT_EQ(sketch.plane().x_dir().x(), 1);
  ASSERT_EQ(sketch.entities().values_size(), 4);
  EXPECT_EQ(sketch.entities().values(0).struct_value().fields().at("id").string_value(), "l1");
  EXPECT_EQ(sketch.entities().values(1).struct_value().fields().at("id").string_value(), "t1");
  EXPECT_EQ(sketch.entities().values(2).struct_value().fields().at("id").string_value(), "p1#1");
  EXPECT_EQ(sketch.entities().values(3).struct_value().fields().at("degree").number_value(), 3);

  ASSERT_EQ(sketch.regions_size(), 1);
  const auto& region = sketch.regions(0);
  EXPECT_EQ(region.name(), "c1,l1,l2,l3,l4");
  ASSERT_EQ(region.outer_size(), 4);
  EXPECT_EQ(region.outer(0).id(), "l1");
  EXPECT_EQ(region.outer(1).line().from().x(), 10);
  EXPECT_EQ(region.outer(1).line().to().y(), 10);
  ASSERT_EQ(region.holes_size(), 1);
  ASSERT_EQ(region.holes(0).curves_size(), 1);
  EXPECT_EQ(region.holes(0).curves(0).circle().radius(), 2);
  EXPECT_EQ(region.holes(0).curves(0).circle().center().x(), 5);
  EXPECT_NEAR(region.area(), 100 - 4 * 3.141592653589793, 1e-12);

  // Anchors of the feature (ok, in front of the bar).
  const auto& anchors = rm.regen().anchors().at("s1").anchors();
  ASSERT_TRUE(anchors.contains("base"));
  EXPECT_EQ(anchors.at("base").direction().z(), 1);
  EXPECT_TRUE(anchors.at("base").has_point());
}

TEST(ReadModelBuilder, TheOriginPlanesAndAxesComeInStateOrder) {
  StudioFixture s;
  const auto rm = s.readModel(*s.load(aDocumentJson(Json::array())));
  const auto& final = rm.regen().final();
  ASSERT_EQ(final.planes_size(), 3);
  EXPECT_EQ(final.planes(0).plane_id(), "origin/plane:xy");
  EXPECT_EQ(final.planes(0).owner(), "origin");
  EXPECT_EQ(final.planes(0).plane().normal().z(), 1);
  ASSERT_EQ(final.axes_size(), 3);
  EXPECT_EQ(final.axes(2).axis_id(), "origin/axis:z");
  EXPECT_EQ(final.axes(2).direction().z(), 1);
  EXPECT_TRUE(final.axes(2).has_origin());
  EXPECT_EQ(final.bodies_size(), 0);
}

// ---- document, statuses, session -------------------------------------------------------------

TEST(ReadModelBuilder, TheDocumentViewCarriesMetaFeaturesBarAndBodyMetadata) {
  StudioFixture s;
  const Json bodies{{"f1/body", {{"hidden", true}, {"name", "Base"}}},
                    {"f2/body", {{"color", "#ff0000"}, {"material", "steel"}}}};
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 2, bodies));
  const auto rm = s.readModel(*doc);
  const auto& view = rm.document();
  EXPECT_EQ(view.document_id(), "doc-1");
  EXPECT_EQ(view.name(), "Part 1");
  EXPECT_EQ(view.last_seq(), 7U);
  EXPECT_EQ(view.created_at_ms(), 1700000000123);
  ASSERT_EQ(view.features_size(), 2);
  EXPECT_EQ(view.features(1).id(), "f2");
  EXPECT_EQ(view.features(1).type(), "box");
  EXPECT_EQ(view.features(1).params().fields().at("height").number_value(), 10);
  EXPECT_EQ(view.rollback_index(), 2U);
  ASSERT_EQ(view.body_meta_size(), 2);
  EXPECT_TRUE(view.body_meta().at("f1/body").hidden());
  EXPECT_EQ(view.body_meta().at("f1/body").name(), "Base");
  EXPECT_FALSE(view.body_meta().at("f1/body").has_color());
  EXPECT_EQ(view.body_meta().at("f1/body").material(), v1::BODY_MATERIAL_UNSPECIFIED);
  EXPECT_EQ(view.body_meta().at("f2/body").color(), "#ff0000");
  EXPECT_EQ(view.body_meta().at("f2/body").material(), v1::BODY_MATERIAL_STEEL);
  // A hidden body stays in the read model: the client hides it.
  EXPECT_EQ(bodiesWithMesh(rm.regen().final()),
            (std::vector<std::string>{"f1/body", "f2/body"}));
}

TEST(ReadModelBuilder, StatusesCoverEveryFeatureWithTheErrorAndItsIssues) {
  StudioFixture s;
  Json suppressed = boxJson("f3", {40, 0, 0});
  suppressed["suppressed"] = true;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0}, 10, -1), suppressed,
                   boxJson("f4", {60, 0, 0})}),
      3));
  const auto rm = s.readModel(*doc);
  const auto& statuses = rm.regen().statuses();
  ASSERT_EQ(statuses.size(), 4U);
  EXPECT_TRUE(statuses.at("f1").has_ok());
  ASSERT_TRUE(statuses.at("f2").has_error());
  const auto& error = statuses.at("f2").error();
  EXPECT_EQ(error.code(), v1::FeatureError::CODE_INVALID_PARAMS);
  ASSERT_GE(error.issues_size(), 1);
  EXPECT_EQ(error.issues(0).param(), "height");
  EXPECT_TRUE(statuses.at("f3").has_suppressed());
  EXPECT_TRUE(statuses.at("f4").has_rolled_back());
  // Anchors only for ok and warning features (a box has none, so an empty entry).
  EXPECT_TRUE(rm.regen().anchors().contains("f1"));
  EXPECT_FALSE(rm.regen().anchors().contains("f2"));
  EXPECT_FALSE(rm.regen().anchors().contains("f4"));
}

TEST(ReadModelBuilder, GenerationAndSessionComeFromTheInput) {
  StudioFixture s;
  const auto rm = s.readModel(*s.load(twoBoxes()));
  EXPECT_EQ(rm.regen().generation(), 3U);
  EXPECT_TRUE(rm.session().writable());
  EXPECT_TRUE(rm.session().can_undo());
  EXPECT_FALSE(rm.session().can_redo());
  ASSERT_TRUE(rm.session().has_transaction());
  EXPECT_EQ(rm.session().transaction().label(), "Box 1: height");
}

TEST(ReadModelBuilder, NoTransactionMeansNoTransactionView) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto result = s.regenerator->run(*doc->studio());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, false, false, false,
                             std::nullopt, testQuality()};
  v1::ReadModel out;
  out.mutable_document()->set_name("stale");
  ASSERT_TRUE(s.builder.build(input, {}, &out).has_value());
  EXPECT_FALSE(out.session().has_transaction());
  EXPECT_FALSE(out.session().writable());
  EXPECT_EQ(out.document().name(), "Part 1");  // `out` cleared first
}

TEST(ReadModelBuilder, AMeshThatFailsToTessellateIsAnInternalError) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto result = s.regenerator->run(*doc->studio());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, true, false, false,
                             std::nullopt, testQuality()};
  s.kernel.failNext("tessellate", kernel::KernelError{kernel::KernelErrorCode::Internal, "x"});
  v1::ReadModel out;
  const auto built = s.builder.build(input, {}, &out);
  ASSERT_FALSE(built.has_value());
  EXPECT_EQ(built.error().reason, ErrorReason::Internal);
}

}  // namespace
}  // namespace tinycad::session::test
