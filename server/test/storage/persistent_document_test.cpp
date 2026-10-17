// PersistentDocument (spec 14 "Změny dokumentu", decisions N36, N155): the document, log,
// dispatcher and undo of ops over a SQLite file, every durable call written before it returns; a
// failed write reverted by the inverse, the reload only as the fallback.

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

  std::unique_ptr<PersistentDocument> open() { return openWith(deps); }

  /** d1 behind a FailingFile; `d` must outlive the document. */
  std::unique_ptr<PersistentDocument> openWith(const PersistentDocument::Dependencies& d) {
    auto file = catalog->open(document::DocumentId("d1"));
    EXPECT_TRUE(file.has_value());
    auto doc = PersistentDocument::open(
        std::make_unique<testing::FailingFile>(std::move(*file), fail), d);
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

  static std::vector<Json> logJson(const PersistentDocument& doc) {
    std::vector<Json> out;
    for (const auto& entry : doc.log().entries()) out.push_back(ops::logEntryJson(entry));
    return out;
  }

  /** The log in memory equals the entries of the file (read through a second connection). */
  void expectTheLogMatchesTheFile(const PersistentDocument& doc) {
    std::vector<Json> stored;
    const StoredDocument file = catalog->open(document::DocumentId("d1")).value()->load().value();
    for (const auto& entry : file.entries) stored.push_back(entry.entry);
    EXPECT_EQ(stored, logJson(doc));
  }
};

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

TEST_F(PersistentDocumentTest, AFailedWriteIsStorageAndTheDocumentIsRevertedByTheInverse) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  const std::vector<Json> logBefore = logJson(*doc);
  fail->append = true;
  auto failed = doc->dispatch(testing::renameOp("a", "Lost"), "x", key(2));
  EXPECT_EQ(codeOf(failed), ChangeErrorCode::Storage);
  EXPECT_FALSE(failed.error().reloaded);
  // The inverse brought the document back; the log and undo never saw the entry (N155).
  EXPECT_EQ(nameOfA(*doc), "B");
  EXPECT_EQ(logJson(*doc), logBefore);
  EXPECT_FALSE(doc->broken());
  EXPECT_TRUE(doc->canUndo());
  EXPECT_FALSE(doc->canRedo());
  expectTheLogMatchesTheFile(*doc);

  // The same key goes through once writing works again, with the next seq.
  fail->append = false;
  auto retried = doc->dispatch(testing::renameOp("a", "Lost"), "x", key(2));
  ASSERT_TRUE(retried.has_value());
  EXPECT_FALSE(retried->repeated);
  EXPECT_EQ((*retried->entry)["seq"], 2);
  EXPECT_EQ(nameOfA(*doc), "Lost");
  EXPECT_EQ(storedSeqs(), (std::vector<std::int64_t>{1, 2}));
  expectTheLogMatchesTheFile(*doc);
}

TEST_F(PersistentDocumentTest, AFailedCommitKeepsTheTransactionOpen) {
  auto doc = open();
  ASSERT_TRUE(doc->begin("Edit"));
  ASSERT_TRUE(doc->apply(testing::renameOp("a", "Kept")));
  ASSERT_TRUE(doc->applyTransient(testing::suppressOp("a", true)));
  ASSERT_TRUE(doc->apply(testing::setParamsOp("a", {{"size", 7}})));
  fail->append = true;
  auto failed = doc->commit(key(1));
  EXPECT_EQ(codeOf(failed), ChangeErrorCode::Storage);
  EXPECT_FALSE(failed.error().reloaded);
  // Open, both steps applied, the transient step gone, nothing stored.
  EXPECT_TRUE(doc->inTransaction());
  EXPECT_EQ(nameOfA(*doc), "Kept");
  EXPECT_EQ(*doc->document().feature(FeatureId("a"))->params, (Json{{"size", 7}}));
  EXPECT_FALSE(doc->document().feature(FeatureId("a"))->suppressed);
  EXPECT_EQ(doc->log().lastSeq(), 0);
  expectTheLogMatchesTheFile(*doc);

  // A retried Commit (same key) writes one entry with both steps (spec 14).
  fail->append = false;
  auto retried = doc->commit(key(1));
  ASSERT_TRUE(retried.has_value());
  ASSERT_TRUE(retried->entry.has_value());
  EXPECT_EQ((*retried->entry)["op"]["type"], "batch");
  EXPECT_EQ((*retried->entry)["op"]["ops"].size(), 2U);
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  EXPECT_TRUE(doc->canUndo());
  expectTheLogMatchesTheFile(*doc);
}

TEST_F(PersistentDocumentTest, AFailedUndoKeepsTheStacks) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  fail->append = true;
  auto failed = doc->undo(key(2));
  EXPECT_EQ(codeOf(failed), ChangeErrorCode::Storage);
  EXPECT_FALSE(failed.error().reloaded);
  EXPECT_EQ(nameOfA(*doc), "B");
  EXPECT_TRUE(doc->canUndo());
  EXPECT_FALSE(doc->canRedo());
  expectTheLogMatchesTheFile(*doc);
  fail->append = false;
  ASSERT_TRUE(doc->undo(key(2)));
  EXPECT_EQ(nameOfA(*doc), "A");
  EXPECT_TRUE(doc->canRedo());
  fail->append = true;
  EXPECT_EQ(codeOf(doc->redo(key(3))), ChangeErrorCode::Storage);
  EXPECT_EQ(nameOfA(*doc), "A");
  EXPECT_TRUE(doc->canRedo());
  expectTheLogMatchesTheFile(*doc);
}

/** A document whose handlers know test.brokenInverse: its inverse always fails (a handler bug). */
class PersistentDocumentBrokenInverseTest : public PersistentDocumentTest {
 protected:
  ops::OpHandlerRegistry handlers = [] {
    ops::OpHandlerRegistry registry(testing::serverSchemas());
    registry.add(std::make_shared<testing::BrokenInverseHandler>());
    return registry;
  }();
  PersistentDocument::Dependencies brokenDeps{testing::serverSchemas(), handlers, clock.clock(),
                                              true};

  std::unique_ptr<PersistentDocument> open() { return openWith(brokenDeps); }
};

TEST_F(PersistentDocumentBrokenInverseTest, WhenTheInverseFailsTheDocumentIsReloaded) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::BrokenInverseHandler::op("Stored"), "x", key(1)));
  fail->append = true;
  auto failed = doc->dispatch(testing::BrokenInverseHandler::op("Lost"), "x", key(2));
  EXPECT_EQ(codeOf(failed), ChangeErrorCode::Storage);
  EXPECT_TRUE(failed.error().reloaded);
  // The file is the state again; no transaction survives a reload.
  EXPECT_EQ(doc->document().meta().name, "Stored");
  EXPECT_EQ(doc->log().lastSeq(), 1);
  EXPECT_FALSE(doc->inTransaction());
  EXPECT_FALSE(doc->broken());
  EXPECT_TRUE(doc->canUndo());
  expectTheLogMatchesTheFile(*doc);
  fail->append = false;
  ASSERT_TRUE(doc->dispatch(testing::BrokenInverseHandler::op("Lost"), "x", key(2)));
  EXPECT_EQ(doc->document().meta().name, "Lost");
  expectTheLogMatchesTheFile(*doc);
}

TEST_F(PersistentDocumentBrokenInverseTest, WhenTheReloadFailsTooTheDocumentIsBroken) {
  auto doc = open();
  fail->append = true;
  fail->load = true;
  ::testing::internal::CaptureStderr();
  auto failed = doc->dispatch(testing::BrokenInverseHandler::op("Lost"), "x", key(1));
  (void)::testing::internal::GetCapturedStderr();
  EXPECT_EQ(codeOf(failed), ChangeErrorCode::Storage);
  EXPECT_FALSE(failed.error().reloaded);
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

TEST_F(PersistentDocumentTest, OpenReportsACorruptUndoTargetAsAnEntryError) {
  {
    auto doc = open();
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "X"), "x", key(1)));
    ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "Y"), "y", key(2)));
  }
  {
    // An undo of entry 1 while entry 2 is the top of the undo stack (N104).
    auto file = catalog->open(document::DocumentId("d1")).value();
    Json undo = testing::anEntryJson(3, testing::renameOp("a", "A"));
    undo["kind"] = "undo";
    undo["target"] = 1;
    const StoredEntry broken{3, std::nullopt, undo};
    ASSERT_TRUE(file->appendEntries(std::span(&broken, 1)));
  }
  auto doc = PersistentDocument::open(catalog->open(document::DocumentId("d1")).value(), deps);
  ASSERT_FALSE(doc.has_value());
  EXPECT_EQ(doc.error().kind, LoadError::Kind::Entry);
  EXPECT_EQ(doc.error().seq, 3);
  ASSERT_EQ(doc.error().issues.size(), 1U);
  EXPECT_EQ(doc.error().issues[0].path, "target");
}

TEST_F(PersistentDocumentTest, TheLogInMemoryMatchesTheFile) {
  auto doc = open();
  ASSERT_TRUE(doc->dispatch(testing::renameOp("a", "B"), "x", key(1)));
  ASSERT_TRUE(doc->begin("T"));
  ASSERT_TRUE(doc->apply(testing::suppressOp("a", true)));
  ASSERT_TRUE(doc->commit(key(2)));
  ASSERT_TRUE(doc->undo(key(3)));
  expectTheLogMatchesTheFile(*doc);
}

}  // namespace
}  // namespace tinycad::storage
