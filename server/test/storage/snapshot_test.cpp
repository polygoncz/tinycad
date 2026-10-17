// snapshotJson (port of test/unit/persistence/snapshot.test.ts without the freezing test).

#include "snapshot.hpp"

#include <gtest/gtest.h>

#include "document/testing.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using testing::aDocument;
using testing::aFeature;

TEST(SnapshotJson, WrapsTheDocumentDataInAVersionedEnvelopeAtTheGivenSeq) {
  const auto doc = aDocument({.features = {aFeature("a")}});
  EXPECT_EQ(snapshotJson(*doc, 7), (Json{{"format", "tinycad.snapshot"},
                                         {"formatVersion", 1},
                                         {"atSeq", 7},
                                         {"document", document::documentDataJson(document::toData(*doc))}}));
}

TEST(SnapshotJson, SurvivesATextRoundTripUnchanged) {
  const Json snapshot = snapshotJson(*aDocument({.features = {aFeature("a")}}), 3);
  EXPECT_EQ(Json::parse(snapshot.dump()), snapshot);
}

TEST(SnapshotJson, LoadsBackToTheSameDocument) {
  const auto doc = aDocument({.features = {aFeature("a"), aFeature("b")}, .rollbackIndex = 1});
  const Json snapshot = snapshotJson(*doc, 0);
  auto loaded = document::fromData(snapshot["document"], document::FeatureSchemaRegistry());
  ASSERT_TRUE(loaded.has_value());
  EXPECT_TRUE(document::sameStudio(*(*loaded)->studio(), *doc->studio()));
  EXPECT_EQ((*loaded)->meta().id, doc->meta().id);
}

}  // namespace
}  // namespace tinycad::storage
