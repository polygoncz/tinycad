// Port of test/unit/document/refs.test.ts: minting and parsing artifact ids (ADR 0015), owners
// of references and reading references from unchecked JSON.

#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/refs.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::AxisId;
using document::BodyId;
using document::EntityRef;
using document::FeatureId;
using document::PlaneId;
using document::RefKind;
using document::TopoName;
using Strings = std::vector<std::string>;

TEST(BodyId, NamesTheSingleBodyOfAFeature) {
  EXPECT_EQ(document::bodyId(FeatureId("f1")).str(), "f1/body");
}

TEST(BodyId, NumbersFurtherBodiesFrom1) {
  EXPECT_EQ(document::bodyId(FeatureId("f1"), 1).str(), "f1/body:1");
  EXPECT_EQ(document::bodyId(FeatureId("f1"), 12).str(), "f1/body:12");
  EXPECT_THROW((void)document::bodyId(FeatureId("f1"), 0), core::AssertionError);
  EXPECT_THROW((void)document::bodyId(FeatureId("f/1")), core::AssertionError);
  EXPECT_THROW((void)document::bodyId(FeatureId("")), core::AssertionError);
}

TEST(OriginOfBody, ReadsTheFeatureBackFromBothForms) {
  EXPECT_EQ(document::originOfBody(BodyId("f1/body")).str(), "f1");
  EXPECT_EQ(document::originOfBody(BodyId("f1/body:3")).str(), "f1");
  EXPECT_THROW((void)document::originOfBody(BodyId("f1")), core::AssertionError);
}

TEST(OwnerOf, EveryKindOfReference) {
  EXPECT_EQ(document::ownerOf(EntityRef::toBody(BodyId("a/body:2"))).str(), "a");
  EXPECT_EQ(document::ownerOf(EntityRef::toTopo(BodyId("a/body"), TopoName("x"))).str(), "a");
  EXPECT_EQ(document::ownerOf(EntityRef::toRegion(FeatureId("s"), "r1")).str(), "s");
  EXPECT_EQ(document::ownerOf(EntityRef::toPlane(PlaneId("origin/plane:xy"))).str(), "origin");
  EXPECT_EQ(document::ownerOf(EntityRef::toAxis(AxisId("origin/axis:z"))).str(), "origin");
  EXPECT_EQ(document::ownerOf(EntityRef::toSketchEntity(FeatureId("s"), "l1")).str(), "s");
}

TEST(ParseBodyId, AcceptsAndRejects) {
  for (const auto& text : Strings{"f1/body", "f1/body:1", "f1/body:12", "a.b-c/body:3"}) {
    EXPECT_EQ(document::parseBodyId(text).value_or(BodyId("?")).str(), text) << text;
  }
  for (const auto& text : Strings{"", "f1", "f1/", "/body", "f1/body:0", "f1/body:01", "f1/body:",
                                  "f1/body:x", "f1/sketch", "f1/b/body", "f1/body/x"}) {
    EXPECT_FALSE(document::parseBodyId(text).has_value()) << text;
  }
}

TEST(SketchId, NamesTheSketchOfAFeature) {
  EXPECT_EQ(document::sketchId(FeatureId("f1")).str(), "f1/sketch");
  for (const auto& owner : Strings{"", "f/1", "/"}) {
    EXPECT_THROW((void)document::sketchId(FeatureId(owner)), core::AssertionError) << owner;
  }
}

TEST(ParsePlaneId, AcceptsAndRejects) {
  for (const auto& text : Strings{"origin/plane:xy", "origin/plane:yz", "f1/plane:1",
                                  "a.b-c/plane:top2"}) {
    EXPECT_TRUE(document::parsePlaneId(text).has_value()) << text;
  }
  for (const auto& text :
       Strings{"", "plane:xy", "/plane:xy", "a/b/plane:xy", "origin/plane:", "origin/plane",
               "origin/plane:XY", "origin/plane:x-y", "origin/plane:xy/z", "origin/body",
               "origin/axis:z"}) {
    EXPECT_FALSE(document::parsePlaneId(text).has_value()) << text;
  }
}

TEST(ParseAxisId, AcceptsAndRejects) {
  for (const auto& text : Strings{"origin/axis:x", "origin/axis:z", "f1/axis:1", "a.b-c/axis:main2"}) {
    EXPECT_TRUE(document::parseAxisId(text).has_value()) << text;
  }
  for (const auto& text :
       Strings{"", "axis:x", "/axis:x", "a/b/axis:x", "origin/axis:", "origin/axis",
               "origin/axis:X", "origin/axis:x-y", "origin/axis:x/y", "origin/plane:xy",
               "origin/body"}) {
    EXPECT_FALSE(document::parseAxisId(text).has_value()) << text;
  }
}

TEST(ParseSketchId, AcceptsAndRejects) {
  for (const auto& text : Strings{"f1/sketch", "a.b-c/sketch", "S1/sketch"}) {
    EXPECT_TRUE(document::parseSketchId(text).has_value()) << text;
  }
  for (const auto& text : Strings{"", "sketch", "/sketch", "a/b/sketch", "f1/sketch:1", "f1/Sketch",
                                  "f1/sketch/x", "f1/body", "sketch-edit"}) {
    EXPECT_FALSE(document::parseSketchId(text).has_value()) << text;
  }
}

TEST(OwnerOfArtifact, ReadsTheTextBeforeTheFirstSlash) {
  EXPECT_EQ(document::ownerOfArtifact("f1/sketch").str(), "f1");
  EXPECT_EQ(document::ownerOfArtifact("origin/plane:xy").str(), "origin");
  EXPECT_EQ(document::ownerOfArtifact("a/b/c").str(), "a");
  EXPECT_THROW((void)document::ownerOfArtifact("f1"), core::AssertionError);
}

TEST(ReadRef, ReadsJustTheFieldsOfTheType) {
  const auto ref = document::readRef(
      RefKind::Topo, Json{{"kind", "topo"}, {"body", "a/body"}, {"name", "f1"}, {"extra", 1}});
  ASSERT_TRUE(ref.has_value());
  EXPECT_EQ(*ref, EntityRef::toTopo(BodyId("a/body"), TopoName("f1")));
  EXPECT_EQ(document::refJson(*ref), (Json{{"kind", "topo"}, {"body", "a/body"}, {"name", "f1"}}));
}

TEST(ReadRef, RefusesAWrongShape) {
  EXPECT_FALSE(document::readRef(RefKind::Body, Json{{"kind", "topo"}, {"body", "a/body"}}));
  EXPECT_FALSE(document::readRef(RefKind::Body, Json{{"kind", "body"}, {"body", "a"}}));
  EXPECT_FALSE(document::readRef(RefKind::Topo, Json{{"kind", "topo"}, {"body", "a/body"}, {"name", ""}}));
  EXPECT_FALSE(document::readRef(RefKind::Body, Json::array({"body"})));
  EXPECT_FALSE(document::readRef(RefKind::Body, Json(nullptr)));
  EXPECT_FALSE(document::readRef(RefKind::SketchEntity,
                                 Json{{"kind", "sketchEntity"}, {"sketch", "s"}, {"entity", ""}}));
  // A region name may be empty; it is a string.
  EXPECT_TRUE(document::readRef(RefKind::Region,
                                Json{{"kind", "region"}, {"sketch", "s"}, {"region", ""}}));
}

TEST(ReadRefOf, TakesTheFirstOfTheKindsTheValueHas) {
  const std::vector<RefKind> kinds = {RefKind::Axis, RefKind::SketchEntity};
  const auto axis = document::readRefOf(kinds, Json{{"kind", "axis"}, {"axis", "origin/axis:z"}});
  ASSERT_TRUE(axis.has_value());
  EXPECT_EQ(axis->kind, RefKind::Axis);
  const auto line =
      document::readRefOf(kinds, Json{{"kind", "sketchEntity"}, {"sketch", "s"}, {"entity", "l"}});
  ASSERT_TRUE(line.has_value());
  EXPECT_EQ(line->kind, RefKind::SketchEntity);
  EXPECT_FALSE(document::readRefOf(kinds, Json{{"kind", "body"}, {"body", "a/body"}}));
}

}  // namespace
}  // namespace tinycad::testing
