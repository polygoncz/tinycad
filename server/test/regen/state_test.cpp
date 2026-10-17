// RegenState and its artifacts (port of test/unit/regen/state.test.ts; plus RegenState::with and
// replaceBodies of test/unit/regen/body-change.test.ts).

#include <gtest/gtest.h>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/origin.hpp"

namespace tinycad::regen::test {
namespace {

std::vector<std::string> idsOf(const RegenState& state) {
  std::vector<std::string> ids;
  for (const auto& a : state.artifacts()) ids.push_back(a->id());
  return ids;
}

ShapeHandle h(std::uint64_t n) { return ShapeHandle{n}; }

TEST(EmptyState, HoldsTheThreeOriginPlanesThenTheThreeOriginAxes) {
  EXPECT_EQ(idsOf(*RegenState::empty()),
            (std::vector<std::string>{"origin/plane:xy", "origin/plane:xz", "origin/plane:yz",
                                      "origin/axis:x", "origin/axis:y", "origin/axis:z"}));
  EXPECT_EQ(RegenState::empty(), RegenState::empty());
}

TEST(EmptyState, GivesEachOriginPlaneTheFrameOfOriginPlanesAndTheOwnerOrigin) {
  const auto planes = RegenState::empty()->planes();
  ASSERT_EQ(planes.size(), 3U);
  for (std::size_t i = 0; i < 3; ++i) {
    EXPECT_EQ(planes[i]->id(), document::ORIGIN_PLANES[i].id);
    EXPECT_EQ(planes[i]->owner().str(), "origin");
    EXPECT_EQ(planes[i]->plane(), document::ORIGIN_PLANES[i].plane);
    EXPECT_EQ(planes[i]->kind(), ArtifactKind::Plane);
  }
  // Spec 12: XY normal +Z, XZ normal −Y, YZ x +Y and normal +X.
  EXPECT_EQ(planes[1]->plane().normal, (core::Vec3{0, -1, 0}));
  EXPECT_EQ(planes[2]->plane().xDir, (core::Vec3{0, 1, 0}));
}

TEST(EmptyState, GivesEachOriginAxisItsOriginAndDirectionAndTheOwnerOrigin) {
  const auto axes = RegenState::empty()->axes();
  ASSERT_EQ(axes.size(), 3U);
  EXPECT_EQ(axes[0]->direction(), (core::Vec3{1, 0, 0}));
  EXPECT_EQ(axes[1]->direction(), (core::Vec3{0, 1, 0}));
  EXPECT_EQ(axes[2]->direction(), (core::Vec3{0, 0, 1}));
  for (const auto& a : axes) {
    EXPECT_EQ(a->owner().str(), "origin");
    EXPECT_EQ(a->origin(), (core::Vec3{0, 0, 0}));
  }
}

TEST(EmptyState, HasNoBodiesAndNoSketches) {
  EXPECT_TRUE(RegenState::empty()->bodies().empty());
  EXPECT_TRUE(RegenState::empty()->sketches().empty());
}

TEST(RegenStateOfKind, GivesTheBodiesInInsertionOrderAsTheSamePointers) {
  const auto a = aBody("a", h(1));
  const auto b = aBody("b", h(2));
  const auto state = aState({b, a});
  const auto bodies = state->bodies();
  ASSERT_EQ(bodies.size(), 2U);
  EXPECT_EQ(bodies[0], b);
  EXPECT_EQ(bodies[1], a);
}

TEST(RegenStateOfKind, LeavesOutOtherKinds) {
  const auto a = aBody("a", h(1));
  const auto b = aBody("b", h(2));
  const auto xy = RegenState::empty()->planes()[0];
  const auto x = RegenState::empty()->axes()[0];
  const auto s = aSketchArtifact("s", {h(3)});
  const auto state = aState({xy, a, x, s, b});
  EXPECT_EQ(state->bodies(), (std::vector<BodyPtr>{a, b}));
  EXPECT_EQ(state->sketches(), std::vector<SketchArtifactPtr>{s});
  EXPECT_EQ(state->planes().size(), 1U);
  EXPECT_EQ(state->axes().size(), 1U);
  EXPECT_EQ(state->find("s/sketch"), s);
  EXPECT_EQ(state->find("nothing"), nullptr);
}

TEST(RegenStateConstruction, RejectsANullArtifactAndADuplicateId) {
  EXPECT_THROW(RegenState({nullptr}), core::AssertionError);
  EXPECT_THROW(RegenState({aBody("a", h(1)), aBody("a", h(2))}), core::AssertionError);
}

TEST(RegenStateWith, ReplacesAnArtifactInPlaceAndAppendsANewOne) {
  const auto a = aBody("a", h(1));
  const auto b = aBody("b", h(2));
  const auto state = aState({a, b});
  const auto a2 = aBody("a", h(3));
  const auto replaced = state->with(a2);
  EXPECT_EQ(replaced->bodies(), (std::vector<BodyPtr>{a2, b}));
  const auto c = aBody("c", h(4));
  EXPECT_EQ(state->with(c)->bodies(), (std::vector<BodyPtr>{a, b, c}));
  // The input state stays as it is.
  EXPECT_EQ(state->bodies(), (std::vector<BodyPtr>{a, b}));
}

TEST(RegenStateReplaceBodies, ReplacesInPlaceRemovesConsumedAndKeepsTheRest) {
  const auto xy = RegenState::empty()->planes()[0];
  const auto a = aBody("a", h(1));
  const auto b = aBody("b", h(2));
  const auto c = aBody("c", h(3));
  const auto state = aState({a, xy, b, c});
  const auto b2 = aBody("b", h(4));
  const auto next = state->replaceBodies({{b->bodyId(), b2}}, {c->bodyId()});
  EXPECT_EQ(idsOf(*next), (std::vector<std::string>{"a/body", "origin/plane:xy", "b/body"}));
  EXPECT_EQ(next->artifacts()[0], a);
  EXPECT_EQ(next->artifacts()[1], xy);
  EXPECT_EQ(next->artifacts()[2], b2);
}

TEST(RegenStateReplaceBodies, ConsumedWinsAndAForeignIdIsNotAdded) {
  const auto a = aBody("a", h(1));
  const auto state = aState({a});
  const auto a2 = aBody("a", h(2));
  const auto z = aBody("z", h(3));
  EXPECT_TRUE(state->replaceBodies({{a->bodyId(), a2}}, {a->bodyId()})->bodies().empty());
  EXPECT_EQ(state->replaceBodies({{z->bodyId(), z}}, {})->bodies(), std::vector<BodyPtr>{a});
}

TEST(Body, KeepsItsLineageAndRejectsANullNameTable) {
  const auto body = std::make_shared<const Body>(document::BodyId("f1/body"), fid("f1"), fid("f2"),
                                                 h(7), NameTable::empty());
  EXPECT_EQ(body->id(), "f1/body");
  EXPECT_EQ(body->origin().str(), "f1");
  EXPECT_EQ(body->lastModifiedBy().str(), "f2");
  EXPECT_EQ(body->shape(), h(7));
  EXPECT_THROW(Body(document::BodyId("f1/body"), fid("f1"), fid("f1"), h(7), nullptr),
               core::AssertionError);
}

TEST(SketchArtifact, HasTheIdOfItsOwnerAndFindsTheFaceOfARegion) {
  const auto s = aSketchArtifact("s1", {h(5), h(6)});
  EXPECT_EQ(s->id(), "s1/sketch");
  EXPECT_EQ(s->kind(), ArtifactKind::Sketch);
  EXPECT_EQ(s->regionFace("r2"), h(6));
  EXPECT_FALSE(s->regionFace("r3").has_value());
  ASSERT_EQ(s->outlines.size(), 2U);
  EXPECT_EQ(s->outlines[1].name, "r2");
}

TEST(FeatureStatusNames, AreTheJsonNames) {
  EXPECT_EQ(featureStatusKindName(FeatureStatusKind::RolledBack), "rolledBack");
  EXPECT_EQ(featureStatusKindName(FeatureStatus::warning("w").kind), "warning");
  EXPECT_EQ(featureErrorCodeName(FeatureErrorCode::StaleVersion), "STALE_VERSION");
  EXPECT_EQ(featureErrorCodeName(FeatureErrorCode::UnresolvedReference), "UNRESOLVED_REFERENCE");
  const auto failed = FeatureStatus::failed({FeatureErrorCode::Kernel, "m", {}});
  EXPECT_EQ(failed.kind, FeatureStatusKind::Error);
  ASSERT_TRUE(failed.error.has_value());
}

}  // namespace
}  // namespace tinycad::regen::test
