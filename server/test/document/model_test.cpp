// Port of test/unit/document/model.test.ts and origin.test.ts: body colors and materials, value
// equality of features and studios, the origin geometry.

#include <gtest/gtest.h>

#include <cmath>
#include <string>
#include <vector>

#include "document/testing.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/document/origin.hpp"

namespace tinycad::testing {
namespace {

using document::BodyMaterial;

TEST(IsBodyColor, AcceptsLowerCaseHexOnly) {
  for (const char* color : {"#000000", "#ff00aa", "#0a1b2c"}) {
    EXPECT_TRUE(document::isBodyColor(color)) << color;
  }
  for (const char* color : {"", "#fff", "#FF0000", "ff0000", "#ff00000", "#gg0000", "red"}) {
    EXPECT_FALSE(document::isBodyColor(color)) << color;
  }
}

TEST(BodyMaterial, ListsTheSixPresetsInUiOrderWithPlasticAsTheDefault) {
  const std::vector<std::string> names(std::begin(document::BODY_MATERIAL_NAMES),
                                       std::end(document::BODY_MATERIAL_NAMES));
  EXPECT_EQ(names, (std::vector<std::string>{"plastic", "aluminium", "steel", "brass", "glass",
                                             "rubber"}));
  EXPECT_EQ(document::DEFAULT_BODY_MATERIAL, BodyMaterial::Plastic);
  for (const auto& name : names) {
    const auto material = document::parseBodyMaterial(name);
    ASSERT_TRUE(material.has_value()) << name;
    EXPECT_EQ(document::bodyMaterialName(*material), name);
  }
  EXPECT_FALSE(document::parseBodyMaterial("Steel"));
  EXPECT_FALSE(document::parseBodyMaterial(""));
}

TEST(SameStudio, ComparesByValueNotByPointer) {
  const auto a = aDocument({.features = {aFeature({.id = "a", .params = core::Json{{"w", 1}}})}});
  const auto b = aDocument({.features = {aFeature({.id = "a", .name = a->feature(document::FeatureId("a"))->name,
                                                   .params = core::Json{{"w", 1.0}}})}});
  EXPECT_TRUE(document::sameStudio(*a->studio(), *b->studio()));
  b->setRollbackIndex(0);
  EXPECT_FALSE(document::sameStudio(*a->studio(), *b->studio()));
}

TEST(SameFeature, ComparesEveryField) {
  const auto f = aFeature({.id = "a", .name = "A"});
  auto g = std::make_shared<document::FeatureInstance>(*f);
  EXPECT_TRUE(document::sameFeature(*f, *g));
  g->suppressed = true;
  EXPECT_FALSE(document::sameFeature(*f, *g));
  g->suppressed = false;
  g->params = std::make_shared<const core::Json>(core::Json{{"size", 2}});
  EXPECT_FALSE(document::sameFeature(*f, *g));
}

TEST(Origin, IsTheReservedOwner) { EXPECT_EQ(document::ORIGIN, "origin"); }

TEST(Origin, ListsThePlanesXyXzYzWithValidIds) {
  const std::vector<std::string> ids = {"origin/plane:xy", "origin/plane:xz", "origin/plane:yz"};
  const std::vector<std::string> labels = {"origin.plane.xy", "origin.plane.xz", "origin.plane.yz"};
  for (std::size_t i = 0; i < 3; ++i) {
    EXPECT_EQ(document::ORIGIN_PLANES[i].id, ids[i]);
    EXPECT_EQ(document::ORIGIN_PLANES[i].label, labels[i]);
    EXPECT_TRUE(document::parsePlaneId(document::ORIGIN_PLANES[i].id).has_value());
  }
  EXPECT_EQ(document::ORIGIN_PLANES[1].plane.normal, (core::Vec3{0, -1, 0}));
}

TEST(Origin, HasOrthonormalFramesWithYUp) {
  // axis y = normal × xDir is +Y, +Z, +Z.
  const std::vector<core::Vec3> expectedY = {{0, 1, 0}, {0, 0, 1}, {0, 0, 1}};
  for (std::size_t i = 0; i < 3; ++i) {
    const auto& p = document::ORIGIN_PLANES[i].plane;
    const core::Vec3 y = {p.normal[1] * p.xDir[2] - p.normal[2] * p.xDir[1],
                          p.normal[2] * p.xDir[0] - p.normal[0] * p.xDir[2],
                          p.normal[0] * p.xDir[1] - p.normal[1] * p.xDir[0]};
    EXPECT_EQ(y, expectedY[i]) << i;
  }
}

TEST(Origin, ListsTheAxesXYZWithValidIds) {
  const std::vector<std::string> ids = {"origin/axis:x", "origin/axis:y", "origin/axis:z"};
  const std::vector<core::Vec3> directions = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
  for (std::size_t i = 0; i < 3; ++i) {
    EXPECT_EQ(document::ORIGIN_AXES[i].id, ids[i]);
    EXPECT_EQ(document::ORIGIN_AXES[i].direction, directions[i]);
    EXPECT_EQ(document::ORIGIN_AXES[i].origin, (core::Vec3{0, 0, 0}));
    EXPECT_TRUE(document::parseAxisId(document::ORIGIN_AXES[i].id).has_value());
  }
}

}  // namespace
}  // namespace tinycad::testing
