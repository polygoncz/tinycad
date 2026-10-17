// PersistentDocument (spec 14 "Změny dokumentu", decisions N35, N36): the document, log, dispatcher
// and undo of ops over a SQLite file, every durable call written before it returns.

#include "tinycad/storage/persistent_document.hpp"

#include <gtest/gtest.h>

#include "failing_file.hpp"
#include "ops/testing.hpp"
#include "storage/testing.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using document::FeatureId;

OperationKey key(int n) { return {"op-" + std::to_string(n), "fp-" + std::to_string(n)}; }

class PersistentDocumentTest : public ::testing::Test {
 protected:
  testing::TempDir dir;
  testing::ManualClock clock;
  std::unique_ptr<DocumentCatalog> catalog = openSqliteCatalog(dir.path(), clock.clock());
  std::shared_ptr<testing::FailSwitches> fail = std::make_shared<testing::FailSwitches>();
  PersistentDocument::Dependencies deps{testing::serverSchemas(), testing::serverHandlers(),
                                        clock.clock(), true};

  void SetUp() override {
    ASSERT_TRUE(catalog->create(testing::metaOf("d1"), testing::aSnapshotJson("d1", 0), std::nullopt));
  }

  std::unique_ptr<PersistentDocument> open() {
    auto file = catalog->open(document::DocumentId("d1"));
    EXPECT_TRUE(file.has_value());
    auto doc = PersistentDocument::open(
        std::make_unique<testing::FailingFile>(std::move(*file), fail), deps);
    EXPECT_TRUE(doc.has_value()) << (doc ? "" : doc.error().message);
    return doc ? std::move(*doc) : nullptr;
  }

  [[nodiscard]] std::filesystem::path path() const { return dir.path() / "d1.tinycad.sqlite"; }

  [[nodiscard]] std::vector<std::int64_t> storedSeqs() const {
    return testing::integerColumn(path(), "SELECT seq FROM operations ORDER BY seq");
  }

  static std::string nameOfA(const PersistentDocument& doc) {
    return doc.document().feature(FeatureId("a"))->name;
  }
};

std::vector<Json> logJson(const PersistentDocument& doc) {
  std::vector<Json> out;
  for (const auto& entry : doc.log().entries()) out.push_back(ops::logEntryJson(entry));
  return out;
}

ChangeErrorCode codeOf(const auto& result) {
  EXPECT_FALSE(result.has_value());
  return result ? ChangeErrorCode::Storage : result.error().code;
}

TEST_F(PersistentDocumentTest, OpensTheStoredDocument) {
  auto doc = open();
  EXPECT_EQ(nameOfA(*doc), "A");
  EXPECT_EQ(doc->log().lastSeq(), 0);
  EXPECT_FALSE(doc->canUndo());
  EXPECT_FALSE(doc->canRedo());
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_FALSE(doc->broken());
}

TEST_F(PersistentDocumentTest, DispatchWritesTheEntryWithItsKeyBeforeItReturns) {
  auto doc = open();
  clock.time = 4242;
  auto change = doc->dispatch(testing::renameOp("a", "Renamed"), "Rename", key(1));
  ASSERT_TRUE(change.has_value());
  EXPECT_FALSE(change->repeated);
  ASSERT_TRUE(change->entry.has_value());
  EXPECT_EQ(*change->entry, ops::logEntryJson(doc->log().entries().back()));
  EXPECT_EQ((*change->entry)["label"], "Rename");
  EXPECT_EQ((*change->entry)["time"], 4242);
  EXPECT_EQ(nameOfA(*doc), "Renamed");
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  EXPECT_EQ(testing::textValue(path(), "SELECT operation_id FROM operations"), "op-1");
  EXPECT_EQ(testing::textValue(path(), "SELECT fingerprint FROM operations"), "fp-1");
  EXPECT_TRUE(doc->canUndo());
}

TEST_F(PersistentDocumentTest, AnEmptyLabelIsTheTypeOfTheOperation) {
  auto doc = open();
  auto change = doc->dispatch(testing::renameOp("a", "Renamed"), "", key(1));
  ASSERT_TRUE(change.has_value());
  EXPECT_EQ((*change->entry)["label"], "feature.rename");
}

TEST_F(PersistentDocumentTest, AnInvalidOperationIsInvalidOperationWithItsPathAndWritesNothing) {
  auto doc = open();
  Json badName = testing::renameOp("a", "x");
  badName["name"] = 42;
  auto change = doc->dispatch(badName, "x", key(1));
  ASSERT_FALSE(change.has_value());
  EXPECT_EQ(change.error().code, ChangeErrorCode::InvalidOperation);
  EXPECT_EQ(change.error().path, "name");
  auto missing = doc->dispatch(testing::renameOp("missing", "X"), "x", key(2));
  EXPECT_EQ(codeOf(missing), ChangeErrorCode::InvalidOperation);
  EXPECT_TRUE(storedSeqs().empty());
  EXPECT_EQ(nameOfA(*doc), "A");
  // The key of a refused call is not used up.
  EXPECT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)).has_value());
}

TEST_F(PersistentDocumentTest, FiftyAppliesAndCommitAreOneEntry) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Drag"));
  EXPECT_TRUE(doc->inTransaction());
  EXPECT_FALSE(doc->canUndo());
  for (int i = 1; i <= 50; ++i) {
    ASSERT_TRUE(doc->apply(testing::setParamsOp("a", {{"size", i}})));
  }
  EXPECT_TRUE(storedSeqs().empty());
  auto change = doc->commit(key(1));
  ASSERT_TRUE(change.has_value());
  ASSERT_TRUE(change->entry.has_value());
  EXPECT_EQ((*change->entry)["label"], "Drag");
  EXPECT_EQ((*change->entry)["op"]["params"], (Json{{"size", 50}}));
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_TRUE(doc->canUndo());
}

TEST_F(PersistentDocumentTest, AbortWritesNothingAndRevertsTheSteps) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Drag"));
  ASSERT_TRUE(doc->apply(testing::renameOp("a", "Temp")));
  ASSERT_TRUE(doc->abort());
  EXPECT_EQ(nameOfA(*doc), "A");
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_TRUE(storedSeqs().empty());
  EXPECT_EQ(doc->log().lastSeq(), 0);
}

TEST_F(PersistentDocumentTest, ATransientStepIsNeverInTheLog) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Edit"));
  ASSERT_TRUE(doc->applyTransient(testing::suppressOp("a", true)));
  ASSERT_TRUE(doc->apply(testing::renameOp("a", "Kept")));
  auto change = doc->commit(key(1));
  ASSERT_TRUE(change.has_value());
  EXPECT_EQ((*change->entry)["op"]["type"], "feature.rename");
  EXPECT_FALSE(doc->document().feature(FeatureId("a"))->suppressed);
  EXPECT_EQ(nameOfA(*doc), "Kept");
}

TEST_F(PersistentDocumentTest, AnEmptyCommitGivesAChangeWithoutEntry) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Nothing"));
  auto change = doc->commit(key(1));
  ASSERT_TRUE(change.has_value());
  EXPECT_FALSE(change->entry.has_value());
  EXPECT_FALSE(change->repeated);
  EXPECT_TRUE(storedSeqs().empty());
}

TEST_F(PersistentDocumentTest, CallsInTheWrongTransactionStateAreErrors) {
  auto doc = open();
  EXPECT_EQ(codeOf(doc->apply(testing::renameOp("a", "X"))), ChangeErrorCode::NoTransaction);
  EXPECT_EQ(codeOf(doc->applyTransient(testing::renameOp("a", "X"))), ChangeErrorCode::NoTransaction);
  EXPECT_EQ(codeOf(doc->commit(key(1))), ChangeErrorCode::NoTransaction);
  EXPECT_EQ(codeOf(doc->abort()), ChangeErrorCode::NoTransaction);
  EXPECT_EQ(codeOf(doc->undo(key(2))), ChangeErrorCode::NothingToUndo);
  EXPECT_EQ(codeOf(doc->redo(key(3))), ChangeErrorCode::NothingToRedo);

  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(4)));
  ASSERT_TRUE(doc->begin("T"));
  EXPECT_EQ(codeOf(doc->begin("Again")), ChangeErrorCode::TransactionOpen);
  EXPECT_EQ(codeOf(doc->dispatch(testing::renameOp("a", "C"), "x", key(5))),
            ChangeErrorCode::TransactionOpen);
  EXPECT_EQ(codeOf(doc->undo(key(6))), ChangeErrorCode::TransactionOpen);
  EXPECT_EQ(codeOf(doc->redo(key(7))), ChangeErrorCode::TransactionOpen);
  EXPECT_EQ(codeOf(doc->apply(testing::renameOp("missing", "C"))), ChangeErrorCode::InvalidOperation);
  EXPECT_TRUE(doc->inTransaction());
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
}

TEST_F(PersistentDocumentTest, UndoAndRedoWriteTheirEntries) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  auto undone = doc->undo(key(2));
  ASSERT_TRUE(undone.has_value());
  EXPECT_EQ((*undone->entry)["kind"], "undo");
  EXPECT_EQ((*undone->entry)["target"], 1);
  EXPECT_EQ(nameOfA(*doc), "A");
  EXPECT_TRUE(doc->canRedo());
  auto redone = doc->redo(key(3));
  ASSERT_TRUE(redone.has_value());
  EXPECT_EQ((*redone->entry)["kind"], "redo");
  EXPECT_EQ(nameOfA(*doc), "B");
  EXPECT_EQ(storedSeqs(), (std::vector<std::int64_t>{1, 2, 3}));
}

TEST_F(PersistentDocumentTest, ReopeningGivesTheSameDocumentLogAndUndo) {
  {
    auto doc = open();
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "C"), "x", key(2)));
    ASSERT_TRUE(doc->undo(key(3)));
  }
  auto reopened = open();
  EXPECT_EQ(nameOfA(*reopened), "B");
  EXPECT_EQ(reopened->log().lastSeq(), 3);
  EXPECT_TRUE(reopened->canUndo());
  EXPECT_TRUE(reopened->canRedo());
  ASSERT_TRUE(reopened->redo(key(4)));
  EXPECT_EQ(nameOfA(*reopened), "C");
}

TEST_F(PersistentDocumentTest, EveryHundredthEntryGetsASnapshot) {
  auto doc = open();
  for (int n = 1; n <= 201; ++n) {
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "A" + std::to_string(n)), "x", key(n)));
  }
  EXPECT_EQ(testing::integerColumn(path(), "SELECT at_seq FROM snapshots ORDER BY at_seq"),
            (std::vector<std::int64_t>{0, 100, 200}));
  const StoredDocument stored = catalog->open(document::DocumentId("d1")).value()->load().value();
  EXPECT_EQ(stored.snapshot["atSeq"], 200);
  EXPECT_EQ(stored.snapshot["document"]["studio"]["features"][0]["name"], "A200");
}

TEST_F(PersistentDocumentTest, AFailedSnapshotIsNotAnErrorOfTheChange) {
  auto doc = open();
  for (int n = 1; n <= 99; ++n) {
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "A" + std::to_string(n)), "x", key(n)));
  }
  fail->snapshot = true;
  ::testing::internal::CaptureStderr();
  auto change = doc->dispatch(testing::renameOp("a", "A100"), "x", key(100));
  const std::string err = ::testing::internal::GetCapturedStderr();
  ASSERT_TRUE(change.has_value());
  EXPECT_NE(err.find("snapshot 100"), std::string::npos) << err;
  EXPECT_EQ(storedSeqs().size(), 100U);
  EXPECT_EQ(testing::integerColumn(path(), "SELECT at_seq FROM snapshots"), std::vector<std::int64_t>{0});
}

TEST_F(PersistentDocumentTest, AFailedWriteIsStorageAndTheDocumentIsReloadedFromTheFile) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  fail->append = true;
  EXPECT_EQ(codeOf(doc->dispatch(testing::renameOp("a", "Lost"), "x", key(2))),
            ChangeErrorCode::Storage);
  // The document equals the file: the failed change is gone, the log is the stored one.
  EXPECT_EQ(nameOfA(*doc), "B");
  EXPECT_EQ(doc->log().lastSeq(), 1);
  EXPECT_FALSE(doc->broken());
  EXPECT_TRUE(doc->canUndo());

  // The same key goes through once writing works again.
  fail->append = false;
  auto retried = doc->dispatch(testing::renameOp("a", "Lost"), "x", key(2));
  ASSERT_TRUE(retried.has_value());
  EXPECT_FALSE(retried->repeated);
  EXPECT_EQ(nameOfA(*doc), "Lost");
  EXPECT_EQ(storedSeqs(), (std::vector<std::int64_t>{1, 2}));
}

TEST_F(PersistentDocumentTest, AFailedCommitDropsTheTransaction) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Drag"));
  ASSERT_TRUE(doc->apply(testing::renameOp("a", "Lost")));
  fail->append = true;
  EXPECT_EQ(codeOf(doc->commit(key(1))), ChangeErrorCode::Storage);
  fail->append = false;
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_EQ(nameOfA(*doc), "A");
  // A repeated Commit after STORAGE finds no transaction (spec 14).
  EXPECT_EQ(codeOf(doc->commit(key(1))), ChangeErrorCode::NoTransaction);
}

TEST_F(PersistentDocumentTest, AFailedUndoIsReloadedToo) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  fail->append = true;
  EXPECT_EQ(codeOf(doc->undo(key(2))), ChangeErrorCode::Storage);
  EXPECT_EQ(nameOfA(*doc), "B");
  EXPECT_TRUE(doc->canUndo());
  EXPECT_FALSE(doc->canRedo());
}

TEST_F(PersistentDocumentTest, WhenTheReloadFailsTooTheDocumentIsBroken) {
  auto doc = open();
  fail->append = true;
  fail->load = true;
  ::testing::internal::CaptureStderr();
  EXPECT_EQ(codeOf(doc->dispatch(testing::renameOp("a", "Lost"), "x", key(1))),
            ChangeErrorCode::Storage);
  (void)::testing::internal::GetCapturedStderr();
  EXPECT_TRUE(doc->broken());
  fail->append = false;
  fail->load = false;
  EXPECT_EQ(codeOf(doc->dispatch(testing::renameOp("a", "X"), "x", key(2))), ChangeErrorCode::Storage);
  EXPECT_EQ(codeOf(doc->undo(key(3))), ChangeErrorCode::Storage);
  EXPECT_EQ(codeOf(doc->begin("T")), ChangeErrorCode::Storage);
  EXPECT_TRUE(storedSeqs().empty());
}

TEST_F(PersistentDocumentTest, OpenReportsBrokenDataAndStorage) {
  {
    auto file = catalog->open(document::DocumentId("d1")).value();
    const StoredEntry broken{1, std::nullopt, testing::anEntryJson(1, testing::renameOp("missing", "X"))};
    ASSERT_TRUE(file->appendEntries(std::span(&broken, 1)));
  }
  auto doc = PersistentDocument::open(catalog->open(document::DocumentId("d1")).value(), deps);
  ASSERT_FALSE(doc.has_value());
  EXPECT_EQ(doc.error().kind, LoadError::Kind::Entry);
  EXPECT_EQ(doc.error().seq, 1);

  fail->load = true;
  auto failing = PersistentDocument::open(
      std::make_unique<testing::FailingFile>(catalog->open(document::DocumentId("d1")).value(), fail),
      deps);
  ASSERT_FALSE(failing.has_value());
  EXPECT_EQ(failing.error().kind, LoadError::Kind::Storage);
}

TEST_F(PersistentDocumentTest, TheLogInMemoryMatchesTheFile) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  ASSERT_TRUE(doc->begin("T"));
  ASSERT_TRUE(doc->apply(testing::suppressOp("a", true)));
  ASSERT_TRUE(doc->commit(key(2)));
  ASSERT_TRUE(doc->undo(key(3)));
  std::vector<Json> stored;
  const StoredDocument file = catalog->open(document::DocumentId("d1")).value()->load().value();
  for (const auto& entry : file.entries) stored.push_back(entry.entry);
  EXPECT_EQ(stored, logJson(*doc));
}

}  // namespace
}  // namespace tinycad::storage
