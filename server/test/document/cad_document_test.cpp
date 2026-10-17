// Port of test/unit/document/cad-document.test.ts: the in-memory Document, its invariants, the
// rollback bar rules (Q029), structural sharing (N17) and body metadata. The event tests of TS
// have no C++ counterpart (decision N21).

#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <vector>

#include "document/testing.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"

namespace tinycad::testing {
namespace {

using document::BodyId;
using document::BodyMaterial;
using document::BodyMeta;
using document::Document;
using document::FeatureId;
using document::FeaturePtr;
using document::PartStudioData;
using Strings = std::vector<std::string>;

std::unique_ptr<Document> docWith(const Strings& ids, std::optional<int> rollbackIndex = {}) {
  DocumentOptions options;
  for (const auto& id : ids) options.features.push_back(aFeature(id));
  options.rollbackIndex = rollbackIndex;
  return aDocument(std::move(options));
}

FeatureId fid(const std::string& id) { return FeatureId(id); }

std::shared_ptr<PartStudioData> studioOf(std::vector<FeaturePtr> features, int rollbackIndex) {
  auto studio = std::make_shared<PartStudioData>();
  studio->features = std::move(features);
  studio->rollbackIndex = rollbackIndex;
  return studio;
}

document::DocumentMeta meta() { return {document::DocumentId("d1"), "Doc", 0}; }

TEST(Document, StartsEmptyWithAnEmptyStudio) {
  Document doc(meta(), std::make_shared<PartStudioData>());
  EXPECT_TRUE(doc.studio()->features.empty());
  EXPECT_EQ(doc.studio()->rollbackIndex, 0);
}

TEST(Document, RejectsAnInitialStudioThatBreaksTheInvariants) {
  EXPECT_THROW(Document(meta(), studioOf({aFeature("a"), aFeature("a")}, 2)), core::AssertionError);
  EXPECT_THROW(Document(meta(), studioOf({aFeature("a")}, 2)), core::AssertionError);
  EXPECT_THROW(Document(meta(), studioOf({aFeature("a")}, -1)), core::AssertionError);
  EXPECT_THROW(Document(meta(), studioOf({aFeature("a/b")}, 1)), core::AssertionError);
  EXPECT_THROW(Document(meta(), studioOf({aFeature("origin")}, 1)), core::AssertionError);
  auto nonCanonical = studioOf({}, 0);
  nonCanonical->bodies[BodyId("a/body")] = BodyMeta{.name = "", .hidden = false};
  EXPECT_THROW(Document(meta(), nonCanonical), core::AssertionError);
}

TEST(Document, LooksFeaturesUpById) {
  const auto doc = docWith({"a", "b"});
  EXPECT_EQ(doc->feature(fid("b"))->id.str(), "b");
  EXPECT_EQ(doc->feature(fid("x")), nullptr);
  EXPECT_EQ(doc->indexOf(fid("b")), 1);
  EXPECT_EQ(doc->indexOf(fid("x")), -1);
}

TEST(DocumentSharing, KeepsUnchangedFeaturesIdenticalAfterReplaceFeature) {
  const auto doc = docWith({"a", "b", "c"});
  const auto before = doc->studio();
  auto changed = std::make_shared<document::FeatureInstance>(*doc->feature(fid("b")));
  changed->name = "B2";
  doc->replaceFeature(changed);
  EXPECT_NE(doc->studio(), before);
  EXPECT_EQ(doc->studio()->features[0], before->features[0]);
  EXPECT_EQ(doc->studio()->features[2], before->features[2]);
  EXPECT_EQ(doc->studio()->features[1], changed);
  // The old snapshot is untouched.
  EXPECT_NE(before->features[1]->name, "B2");
  EXPECT_NE(before->features[1], changed);
}

TEST(DocumentSharing, AMutatorThatChangesNothingKeepsTheSameStudio) {
  const auto doc = docWith({"a", "b"}, 1);
  const auto before = doc->studio();
  doc->replaceFeature(doc->feature(fid("a")));
  doc->moveFeature(fid("a"), 0);
  doc->setRollbackIndex(1);
  doc->setBodyMeta(BodyId("a/body"), BodyMeta{});
  doc->setBodyMeta(BodyId("a/body"), BodyMeta{.name = ""});
  EXPECT_EQ(doc->studio(), before);
}

TEST(DocumentMutators, InsertsRemovesAndMovesFeatures) {
  const auto doc = docWith({"a", "b"});
  doc->insertFeature(1, aFeature("x"));
  EXPECT_EQ(featureIds(*doc->studio()), (Strings{"a", "x", "b"}));
  doc->moveFeature(fid("a"), 2);
  EXPECT_EQ(featureIds(*doc->studio()), (Strings{"x", "b", "a"}));
  doc->removeFeature(fid("b"));
  EXPECT_EQ(featureIds(*doc->studio()), (Strings{"x", "a"}));
}

TEST(DocumentMutators, RenamesTheDocumentAndKeepsTheStudio) {
  const auto doc = docWith({});
  const auto before = doc->studio();
  doc->rename("New");
  EXPECT_EQ(doc->meta().name, "New");
  EXPECT_EQ(doc->meta().id.str(), "doc1");
  EXPECT_EQ(doc->studio(), before);
}

TEST(DocumentMutators, ThrowsOnProgrammerErrors) {
  const auto doc = docWith({"a", "b"});
  EXPECT_THROW(doc->insertFeature(1, aFeature("a")), core::AssertionError);
  EXPECT_THROW(doc->insertFeature(3, aFeature("x")), core::AssertionError);
  EXPECT_THROW(doc->insertFeature(-1, aFeature("x")), core::AssertionError);
  EXPECT_THROW(doc->removeFeature(fid("x")), core::AssertionError);
  EXPECT_THROW(doc->replaceFeature(aFeature("x")), core::AssertionError);
  EXPECT_THROW(doc->moveFeature(fid("a"), 2), core::AssertionError);
  EXPECT_THROW(doc->setRollbackIndex(3), core::AssertionError);
  EXPECT_THROW(doc->setRollbackIndex(-1), core::AssertionError);
}

TEST(DocumentMutators, LeavesTheDocumentUnchangedWhenAMutatorThrows) {
  const auto doc = docWith({"a"});
  const auto before = doc->studio();
  EXPECT_THROW(doc->insertFeature(0, aFeature("a")), core::AssertionError);
  EXPECT_EQ(doc->studio(), before);
}

// Q029: the active/rolled-back state of the other features never changes.
// [a, b | c, d] – rollbackIndex 2
struct InsertCase {
  int index;
  int expected;
};
class RollbackInsert : public ::testing::TestWithParam<InsertCase> {};
TEST_P(RollbackInsert, MovesTheBar) {
  const auto doc = docWith({"a", "b", "c", "d"}, 2);
  doc->insertFeature(GetParam().index, aFeature("x"));
  EXPECT_EQ(doc->studio()->rollbackIndex, GetParam().expected);
}
INSTANTIATE_TEST_SUITE_P(Document, RollbackInsert,
                         ::testing::Values(InsertCase{0, 3}, InsertCase{2, 3}, InsertCase{3, 2},
                                           InsertCase{4, 2}));

struct RemoveCase {
  const char* id;
  int expected;
};
class RollbackRemove : public ::testing::TestWithParam<RemoveCase> {};
TEST_P(RollbackRemove, MovesTheBar) {
  const auto doc = docWith({"a", "b", "c", "d"}, 2);
  doc->removeFeature(fid(GetParam().id));
  EXPECT_EQ(doc->studio()->rollbackIndex, GetParam().expected);
}
INSTANTIATE_TEST_SUITE_P(Document, RollbackRemove,
                         ::testing::Values(RemoveCase{"a", 1}, RemoveCase{"b", 1},
                                           RemoveCase{"c", 2}, RemoveCase{"d", 2}));

struct MoveCase {
  const char* id;
  int to;
  int expected;
  Strings active;
};
class RollbackMove : public ::testing::TestWithParam<MoveCase> {};
TEST_P(RollbackMove, PutsTheBar) {
  const auto doc = docWith({"a", "b", "c", "d"}, 2);
  doc->moveFeature(fid(GetParam().id), GetParam().to);
  EXPECT_EQ(doc->studio()->rollbackIndex, GetParam().expected);
  const Strings ids = featureIds(*doc->studio());
  EXPECT_EQ(Strings(ids.begin(), ids.begin() + GetParam().expected), GetParam().active);
}
INSTANTIATE_TEST_SUITE_P(
    Document, RollbackMove,
    ::testing::Values(MoveCase{"a", 1, 2, {"b", "a"}},       // within the active part
                      MoveCase{"a", 3, 1, {"b"}},            // active feature moved behind the bar
                      MoveCase{"d", 0, 3, {"d", "a", "b"}},  // rolled-back moved before the bar
                      MoveCase{"d", 2, 3, {"a", "b", "d"}},  // onto the bar: takes the active state
                      MoveCase{"c", 3, 2, {"a", "b"}}));     // within the rolled-back part

TEST(DocumentRollback, SetsTheBarAnywhereIn0ToLength) {
  const auto doc = docWith({"a", "b", "c", "d"}, 2);
  doc->setRollbackIndex(0);
  EXPECT_EQ(doc->studio()->rollbackIndex, 0);
  doc->setRollbackIndex(4);
  EXPECT_EQ(doc->studio()->rollbackIndex, 4);
}

// Body metadata (M11, M15, M24).

const BodyId kBody("a/body");

TEST(DocumentBodyMeta, HasNoMetadataAtFirst) {
  const auto doc = docWith({});
  EXPECT_TRUE(doc->bodyMeta(kBody).empty());
  EXPECT_TRUE(doc->studio()->bodies.empty());
}

TEST(DocumentBodyMeta, StoresANameAndHidden) {
  const auto doc = docWith({});
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid", .hidden = true});
  EXPECT_EQ(doc->bodyMeta(kBody), (BodyMeta{.name = "Lid", .hidden = true}));
}

TEST(DocumentBodyMeta, KeepsTheCanonicalForm) {
  const auto doc = docWith({});
  doc->setBodyMeta(kBody, BodyMeta{.name = "", .hidden = true, .color = "#FF0000",
                                   .material = BodyMaterial::Plastic});
  EXPECT_EQ(doc->bodyMeta(kBody), (BodyMeta{.hidden = true}));
}

TEST(DocumentBodyMeta, StoresAColorAndAMaterialOtherThanPlastic) {
  const auto doc = docWith({});
  doc->setBodyMeta(kBody, BodyMeta{.color = "#00ff00", .material = BodyMaterial::Steel});
  EXPECT_EQ(doc->bodyMeta(kBody), (BodyMeta{.color = "#00ff00", .material = BodyMaterial::Steel}));
}

TEST(DocumentBodyMeta, RemovesTheEntryForEmptyMetadata) {
  const auto doc = docWith({});
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid"});
  doc->setBodyMeta(BodyId("b/body"), BodyMeta{.hidden = true});
  doc->setBodyMeta(kBody, BodyMeta{});
  EXPECT_EQ(doc->studio()->bodies.size(), 1U);
  doc->setBodyMeta(BodyId("b/body"), BodyMeta{.material = BodyMaterial::Plastic});
  EXPECT_TRUE(doc->studio()->bodies.empty());
}

TEST(DocumentBodyMeta, TheSameMetadataByValueIsNoChange) {
  const auto doc = docWith({});
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid", .color = "#00ff00"});
  const auto before = doc->studio();
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid", .color = "#00ff00"});
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid", .color = "#00ff00", .material = BodyMaterial::Plastic});
  EXPECT_EQ(doc->studio(), before);
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid", .color = "#0000ff"});
  EXPECT_NE(doc->studio(), before);
}

TEST(DocumentBodyMeta, KeepsTheSameFeaturesAndRollbackIndex) {
  const auto doc = docWith({"a", "b"}, 1);
  const auto before = doc->studio();
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid"});
  EXPECT_EQ(doc->studio()->features, before->features);
  EXPECT_EQ(doc->studio()->rollbackIndex, 1);
}

TEST(DocumentBodyMeta, EveryOtherMutatorKeepsTheMetadata) {
  const auto doc = docWith({"a", "b"});
  doc->setBodyMeta(kBody, BodyMeta{.name = "Lid"});
  doc->insertFeature(0, aFeature("x"));
  doc->moveFeature(fid("x"), 2);
  doc->removeFeature(fid("x"));
  doc->setRollbackIndex(0);
  doc->rename("N");
  EXPECT_EQ(doc->bodyMeta(kBody), (BodyMeta{.name = "Lid"}));
}

TEST(DocumentBodyMeta, StartsFromTheMetadataOfAnInitialStudio) {
  auto studio = studioOf({}, 0);
  studio->bodies[kBody] = BodyMeta{.name = "Lid"};
  Document doc(meta(), studio);
  EXPECT_EQ(doc.bodyMeta(kBody), (BodyMeta{.name = "Lid"}));
}

}  // namespace
}  // namespace tinycad::testing
