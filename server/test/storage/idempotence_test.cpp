// Durable idempotence (spec 14 "Idempotence", decisions N34, N39): a repeated request with the
// same OperationKey writes one record and returns the stored one, also after the file was closed
// and opened again (the counterpart of a restarted server); the same id with another fingerprint
// is OPERATION_ID_REUSED.

#include <gtest/gtest.h>

#include "ops/testing.hpp"
#include "storage/testing.hpp"
#include "tinycad/storage/document_service.hpp"
#include "tinycad/storage/persistent_document.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using document::FeatureId;

class IdempotenceTest : public ::testing::Test {
 protected:
  testing::TempDir dir;
  testing::ManualClock clock;
  std::unique_ptr<DocumentCatalog> catalog = openSqliteCatalog(dir.path(), clock.clock());
  PersistentDocument::Dependencies deps{testing::serverSchemas(), testing::serverHandlers(),
                                        clock.clock(), true};
  int nextId = 0;
  DocumentService service{{*catalog, testing::serverSchemas(), testing::serverHandlers(),
                           clock.clock(), [this] { return "doc" + std::to_string(++nextId); }}};

  void SetUp() override {
    ASSERT_TRUE(catalog->create(testing::metaOf("d1"), testing::aSnapshotJson("d1", 0), std::nullopt));
  }

  std::unique_ptr<PersistentDocument> open() {
    return PersistentDocument::open(catalog->open(document::DocumentId("d1")).value(), deps).value();
  }

  [[nodiscard]] std::vector<std::int64_t> storedSeqs() const {
    return testing::integerColumn(dir.path() / "d1.tinycad.sqlite",
                                  "SELECT seq FROM operations ORDER BY seq");
  }
};

TEST_F(IdempotenceTest, DispatchTwiceWithTheSameKeyIsOneEntry) {
  auto doc = open();
  const OperationKey key{"op-1", "fp-1"};
  auto first = doc->dispatch(testing::renameOp("a", "B"), "x", key);
  ASSERT_TRUE(first.has_value());
  EXPECT_FALSE(first->repeated);
  auto second = doc->dispatch(testing::renameOp("a", "B"), "x", key);
  ASSERT_TRUE(second.has_value());
  EXPECT_TRUE(second->repeated);
  EXPECT_EQ(second->entry, first->entry);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  EXPECT_EQ(doc->log().lastSeq(), 1);
}

TEST_F(IdempotenceTest, ARepeatIsNotAppliedEvenWhenTheDocumentMovedOn) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"}));
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "C"), "x", {"op-2", "fp-2"}));
  auto repeated = doc->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"});
  ASSERT_TRUE(repeated.has_value());
  EXPECT_TRUE(repeated->repeated);
  EXPECT_EQ(doc->document().feature(FeatureId("a"))->name, "C");
}

TEST_F(IdempotenceTest, CommitTwiceWithTheSameKeyIsOneEntryEvenWithoutATransaction) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("T"));
  ASSERT_TRUE(doc->apply(testing::renameOp("a", "B")));
  const OperationKey key{"op-1", "fp-1"};
  auto first = doc->commit(key);
  ASSERT_TRUE(first.has_value());
  auto second = doc->commit(key);
  ASSERT_TRUE(second.has_value());
  EXPECT_TRUE(second->repeated);
  EXPECT_EQ(second->entry, first->entry);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
}

TEST_F(IdempotenceTest, UndoAndRedoTwiceWithTheSameKeyAreOneEntryEach) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"}));
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "C"), "x", {"op-2", "fp-2"}));
  ASSERT_TRUE(doc->undo({"undo-1", "fp"}));
  auto undoAgain = doc->undo({"undo-1", "fp"});
  ASSERT_TRUE(undoAgain.has_value());
  EXPECT_TRUE(undoAgain->repeated);
  EXPECT_EQ(doc->document().feature(FeatureId("a"))->name, "B");
  ASSERT_TRUE(doc->redo({"redo-1", "fp"}));
  auto redoAgain = doc->redo({"redo-1", "fp"});
  ASSERT_TRUE(redoAgain.has_value());
  EXPECT_TRUE(redoAgain->repeated);
  EXPECT_EQ(doc->document().feature(FeatureId("a"))->name, "C");
  EXPECT_EQ(storedSeqs(), (std::vector<std::int64_t>{1, 2, 3, 4}));
}

TEST_F(IdempotenceTest, ARepeatAfterReopeningTheFileFindsTheStoredEntry) {
  Json written;
  {
    auto doc = open();
    ASSERT_TRUE(doc->begin("T"));
    ASSERT_TRUE(doc->apply(testing::renameOp("a", "B")));
    written = *doc->commit({"op-1", "fp-1"}).value().entry;
  }
  auto reopened = open();
  auto repeated = reopened->commit({"op-1", "fp-1"});
  ASSERT_TRUE(repeated.has_value());
  EXPECT_TRUE(repeated->repeated);
  EXPECT_EQ(*repeated->entry, written);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
}

TEST_F(IdempotenceTest, TheSameIdWithAnotherFingerprintIsOperationIdReused) {
  {
    auto doc = open();
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"}));
    auto reused = doc->dispatch(testing::renameOp("a", "C"), "x", {"op-1", "other"});
    ASSERT_FALSE(reused.has_value());
    EXPECT_EQ(reused.error().code, ChangeErrorCode::OperationIdReused);
    EXPECT_EQ(doc->document().feature(FeatureId("a"))->name, "B");
  }
  auto reopened = open();
  auto reused = reopened->undo({"op-1", "other"});
  ASSERT_FALSE(reused.has_value());
  EXPECT_EQ(reused.error().code, ChangeErrorCode::OperationIdReused);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
}

TEST_F(IdempotenceTest, LookupFindsTheStoredEntryWithoutApplyingAnything) {
  auto doc = open();
  auto missing = doc->lookup({"op-1", "fp-1"});
  ASSERT_TRUE(missing.has_value());
  EXPECT_FALSE(missing->has_value());

  const Json written =
      *doc->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"}).value().entry;
  auto found = doc->lookup({"op-1", "fp-1"});
  ASSERT_TRUE(found.has_value());
  ASSERT_TRUE(found->has_value());
  EXPECT_TRUE((*found)->repeated);
  EXPECT_EQ(*(*found)->entry, written);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});

  auto reused = doc->lookup({"op-1", "other"});
  ASSERT_FALSE(reused.has_value());
  EXPECT_EQ(reused.error().code, ChangeErrorCode::OperationIdReused);
}

TEST_F(IdempotenceTest, LookupAfterReopeningTheFileFindsTheEntry) {
  { ASSERT_TRUE(open()->dispatch(testing::renameOp("a", "B"), "x", {"op-1", "fp-1"})); }
  auto found = open()->lookup({"op-1", "fp-1"});
  ASSERT_TRUE(found.has_value());
  EXPECT_TRUE(found->has_value());
}

// --- DocumentService ----------------------------------------------------------------------

TEST_F(IdempotenceTest, CreateWithTheSameKeyGivesTheSameDocument) {
  const auto first = service.create("Part", {"create-1", "fp"}).value();
  const auto second = service.create("Part", {"create-1", "fp"}).value();
  EXPECT_EQ(second.id, first.id);
  EXPECT_EQ(nextId, 1);
  // After a restart (a new catalog and service over the same directory) too.
  auto restarted = openSqliteCatalog(dir.path(), clock.clock());
  DocumentService again({*restarted, testing::serverSchemas(), testing::serverHandlers(),
                         clock.clock(), [] { return std::string("other"); }});
  EXPECT_EQ(again.create("Part", {"create-1", "fp"}).value().id, first.id);
  EXPECT_EQ(service.list().value().size(), 2U);  // d1 and the created one
}

TEST_F(IdempotenceTest, CreateWithTheSameIdAndAnotherFingerprintIsOperationIdReused) {
  ASSERT_TRUE(service.create("Part", {"create-1", "fp"}));
  auto reused = service.create("Other", {"create-1", "fp-other"});
  ASSERT_FALSE(reused.has_value());
  EXPECT_EQ(reused.error().code, ServiceErrorCode::OperationIdReused);
  EXPECT_EQ(service.list().value().size(), 2U);
}

TEST_F(IdempotenceTest, ImportWithTheSameKeyGivesTheSameDocument) {
  const std::string file =
      Json{{"format", "tinycad.file"},
           {"formatVersion", 2},
           {"snapshot", testing::aSnapshotJson("src", 0)}}
          .dump();
  const auto first = service.importFile(file, {"import:abc", "abc"}).value();
  const auto second = service.importFile(file, {"import:abc", "abc"}).value();
  EXPECT_EQ(second.id, first.id);
  EXPECT_EQ(service.list().value().size(), 2U);
}

TEST(ImportKey, IsTheSha256OfTheContentWithTheImportPrefix) {
  const OperationKey key = importKey("abc");
  EXPECT_EQ(key.fingerprint, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  EXPECT_EQ(key.id, "import:" + key.fingerprint);
  EXPECT_NE(importKey("abd").id, key.id);
}

TEST_F(IdempotenceTest, RenameWithTheSameKeyIsOneEntry) {
  ASSERT_TRUE(service.rename(document::DocumentId("d1"), "Renamed", {"rename-1", "fp"}));
  const auto again = service.rename(document::DocumentId("d1"), "Renamed", {"rename-1", "fp"});
  ASSERT_TRUE(again.has_value());
  EXPECT_EQ(again->name, "Renamed");
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  auto reused = service.rename(document::DocumentId("d1"), "Other", {"rename-1", "fp-other"});
  ASSERT_FALSE(reused.has_value());
  EXPECT_EQ(reused.error().code, ServiceErrorCode::OperationIdReused);
}

}  // namespace
}  // namespace tinycad::storage
