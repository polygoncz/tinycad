// The read model in the tinycad.v1 messages (spec 14 "Read model a sítě", read_model_proto.hpp):
// the conversion of the domain read model of read_model_builder_test.cpp, byte for byte what the
// client reads (meshes, names and planes of faces, sketches, document view, statuses).

#include "tinycad/rpc/read_model_proto.hpp"

#include <gtest/gtest.h>

#include <bit>
#include <memory>
#include <set>
#include <stdexcept>
#include <cstdint>
#include <string>
#include <vector>

#include "session/testing.hpp"

namespace tinycad::rpc {
namespace {

namespace v1 = tinycad::v1;
using session::ReadModelInput;
using session::ReadModelOptions;
using session::test::aDocumentJson;
using session::test::aFeatureJson;
using session::test::boxJson;
using session::test::cylinderJson;
using session::test::Json;
using session::test::optionsWith;
using session::test::StudioFixture;
using session::test::testQuality;

/** The read model of the document in the tinycad.v1 form. */
v1::ReadModel protoOf(StudioFixture& s, const document::DocumentReader& doc,
                      const ReadModelOptions& options = {}) {
  v1::ReadModel out;
  readModelToProto(s.readModel(doc, options), &out);
  return out;
}

/** content_version of every body of the state view, in order. */
std::vector<std::string> versionsOf(const v1::StateView& state) {
  std::vector<std::string> out;
  for (const auto& body : state.bodies()) out.push_back(body.content_version());
  return out;
}

/** Ids of the bodies of the state view that carry a mesh, in order. */
std::vector<std::string> bodiesWithMesh(const v1::StateView& state) {
  std::vector<std::string> out;
  for (const auto& body : state.bodies()) {
    if (body.has_mesh()) out.push_back(body.body_id());
  }
  return out;
}

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

Json twoBoxes() {
  return aDocumentJson(Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}));
}

// ---- meshes and the input ------------------------------------------------------------------

TEST(ReadModelProto, MeshBytesDecodeBackToTheMeshDataWithoutLoss) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(Json::array({cylinderJson("f1")})));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, KnownMeshesAndTheInputComeOutAsTheDomainHasThem) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto all = protoOf(s, *doc);
  EXPECT_EQ(bodiesWithMesh(all.regen().final()), (std::vector<std::string>{"f1/body", "f2/body"}));
  EXPECT_FALSE(all.regen().has_input());
  const std::string f1Version = all.regen().final().bodies(0).content_version();
  const auto rm = protoOf(s, *doc, optionsWith({f1Version}, "f2"));
  EXPECT_EQ(versionsOf(rm.regen().final()), versionsOf(all.regen().final()));
  EXPECT_EQ(bodiesWithMesh(rm.regen().final()), std::vector<std::string>{"f2/body"});
  ASSERT_TRUE(rm.regen().has_input());
  EXPECT_EQ(rm.regen().input().feature_id(), "f2");
  const auto& input = rm.regen().input().state();
  ASSERT_EQ(input.bodies_size(), 1);
  EXPECT_EQ(input.bodies(0).body_id(), "f1/body");
  EXPECT_EQ(input.bodies(0).content_version(), f1Version);
  EXPECT_FALSE(input.bodies(0).has_mesh());
  EXPECT_EQ(input.planes_size(), 3);
  // The bodies are still there with their names.
  EXPECT_EQ(rm.regen().final().bodies(0).face_names_size(), 6);
}

// ---- names and planes of faces ---------------------------------------------------------------

TEST(ReadModelProto, FaceAndEdgeNamesArePrimaryNamesByIndex) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(Json::array({boxJson("f1", {0, 0, 0})})));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, TheTopFaceOfABoxHasItsPlaneAndACylindricalFaceHasNone) {
  StudioFixture s;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}, 10, 7), cylinderJson("f2", 5, 10)})));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, ASketchCarriesItsEntitiesThenTheDerivedOnesAndTheRegionsWithOutlines) {
  StudioFixture s;
  const Json entities = Json::array({Json{{"id", "l1"}, {"kind", "line"}},
                                     Json{{"id", "t1"}, {"kind", "text"}, {"text", "Hi"}}});
  const Json derived = Json::array({Json{{"id", "p1#1"}, {"kind", "line"}},
                                    Json{{"id", "t1#H"}, {"kind", "bspline"}, {"degree", 3}}});
  const auto doc = s.load(aDocumentJson(Json::array(
      {aFeatureJson("s1", "testSketch", Json{{"entities", entities}, {"derived", derived}})})));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, TheOriginPlanesAndAxesComeInStateOrder) {
  StudioFixture s;
  const auto rm = protoOf(s, *s.load(aDocumentJson(Json::array())));
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

TEST(ReadModelProto, TheDocumentViewCarriesMetaFeaturesBarAndBodyMetadata) {
  StudioFixture s;
  const Json bodies{{"f1/body", {{"hidden", true}, {"name", "Base"}}},
                    {"f2/body", {{"color", "#ff0000"}, {"material", "steel"}}}};
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0})}), 2, bodies));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, StatusesCoverEveryFeatureWithTheErrorAndItsIssues) {
  StudioFixture s;
  Json suppressed = boxJson("f3", {40, 0, 0});
  suppressed["suppressed"] = true;
  const auto doc = s.load(aDocumentJson(
      Json::array({boxJson("f1", {0, 0, 0}), boxJson("f2", {20, 0, 0}, 10, -1), suppressed,
                   boxJson("f4", {60, 0, 0})}),
      3));
  const auto rm = protoOf(s, *doc);
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

TEST(ReadModelProto, GenerationAndSessionComeFromTheDomain) {
  StudioFixture s;
  const auto rm = protoOf(s, *s.load(twoBoxes()));
  EXPECT_EQ(rm.regen().generation(), 3U);
  EXPECT_TRUE(rm.session().writable());
  EXPECT_TRUE(rm.session().can_undo());
  EXPECT_FALSE(rm.session().can_redo());
  ASSERT_TRUE(rm.session().has_transaction());
  EXPECT_EQ(rm.session().transaction().label(), "Box 1: height");
}

TEST(ReadModelProto, NoTransactionMeansNoTransactionView) {
  StudioFixture s;
  const auto doc = s.load(twoBoxes());
  const auto result = s.regenerator->run(*doc->studio());
  const ReadModelInput input{*doc, 0, 1, result, *s.regenerator, false, false, false,
                             std::nullopt, testQuality()};
  const auto built = s.builder.build(input, {});
  ASSERT_TRUE(built.has_value());
  v1::ReadModel out;
  out.mutable_document()->set_name("stale");
  readModelToProto(*built, &out);
  EXPECT_FALSE(out.session().has_transaction());
  EXPECT_FALSE(out.session().writable());
  EXPECT_EQ(out.document().name(), "Part 1");  // `out` cleared first
}

}  // namespace
}  // namespace tinycad::rpc
