// One SQLite document file (port of the appendEntries, saveSnapshot and name rules of
// describeDocumentStoreContract in src/persistence/testing.ts, tightened by N34: no overwrite of
// stored seqs, idempotence through operation_id). A refused call is checked to change nothing by
// reading the tables directly.

#include <gtest/gtest.h>

#include <thread>

#include "storage/testing.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::storage {
namespace {

using testing::anEntry;
using testing::aSnapshotJson;
using testing::integerColumn;
using testing::textValue;

class DocumentFileTest : public ::testing::Test {
 protected:
  testing::TempDir dir;
  testing::ManualClock clock;
  std::unique_ptr<DocumentCatalog> catalog = openSqliteCatalog(dir.path(), clock.clock());
  std::unique_ptr<DocumentFile> file = create("d1");

  std::unique_ptr<DocumentFile> create(const std::string& id) {
    return catalog->create(testing::metaOf(id), aSnapshotJson(id, 0), std::nullopt).value();
  }

  static std::vector<StoredEntry> entries(std::int64_t from, std::int64_t to) {
    std::vector<StoredEntry> out;
    for (std::int64_t seq = from; seq <= to; ++seq) out.push_back(anEntry(seq));
    return out;
  }

  void append(const std::vector<StoredEntry>& batch) {
    auto appended = file->appendEntries(batch);
    ASSERT_TRUE(appended.has_value()) << appended.error().message;
  }

  [[nodiscard]] std::filesystem::path path() const { return dir.path() / "d1.tinycad.sqlite"; }

  [[nodiscard]] std::vector<std::int64_t> storedSeqs() const {
    return integerColumn(path(), "SELECT seq FROM operations ORDER BY seq");
  }

  [[nodiscard]] std::vector<std::int64_t> storedSnapshots() const {
    return integerColumn(path(), "SELECT at_seq FROM snapshots ORDER BY at_seq");
  }

  std::vector<Json> loadedEntries() {
    std::vector<Json> out;
    const StoredDocument loaded = file->load().value();
    for (const StoredEntry& e : loaded.entries) out.push_back(e.entry);
    return out;
  }
};

StoreErrorCode codeOf(const StoreResult<void>& result) {
  EXPECT_FALSE(result.has_value());
  return result ? StoreErrorCode::Io : result.error().code;
}

std::vector<Json> jsonOf(const std::vector<StoredEntry>& entries) {
  std::vector<Json> out;
  for (const StoredEntry& e : entries) out.push_back(e.entry);
  return out;
}

// --- appendEntries ------------------------------------------------------------------------

TEST_F(DocumentFileTest, StoresEntriesAndSetsLastSeqAndUpdatedAt) {
  clock.time = 2000;
  append(entries(1, 3));
  const DocumentInfo info = file->info().value();
  EXPECT_EQ(info.lastSeq, 3);
  EXPECT_EQ(info.updatedAt, 2000);
  EXPECT_EQ(info.meta.name, "Doc d1");
  EXPECT_EQ(loadedEntries(), jsonOf(entries(1, 3)));
}

TEST_F(DocumentFileTest, AppendsBatchAfterBatchAndLoadsThemOrderedBySeq) {
  append(entries(1, 2));
  append(entries(3, 3));
  append(entries(4, 5));
  EXPECT_EQ(file->info().value().lastSeq, 5);
  EXPECT_EQ(loadedEntries(), jsonOf(entries(1, 5)));
}

TEST_F(DocumentFileTest, AnEmptyBatchChangesNothingNotEvenUpdatedAt) {
  append(entries(1, 2));
  const double before = file->info().value().updatedAt;
  clock.time = 9000;
  EXPECT_TRUE(file->appendEntries({}).has_value());
  EXPECT_EQ(file->info().value().updatedAt, before);
  EXPECT_EQ(file->info().value().lastSeq, 2);
}

TEST_F(DocumentFileTest, AFirstSeqBeyondLastSeqPlusOneIsSeqGapAndWritesNothing) {
  append(entries(1, 1));
  const DocumentInfo before = file->info().value();
  clock.time = 9000;
  EXPECT_EQ(codeOf(file->appendEntries(entries(3, 4))), StoreErrorCode::SeqGap);
  EXPECT_EQ(file->info().value().updatedAt, before.updatedAt);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
}

TEST_F(DocumentFileTest, StoredSeqsAreNeverOverwrittenN34) {
  append(entries(1, 3));
  StoredEntry relabelled = anEntry(2);
  relabelled.entry["label"] = "rewritten";
  EXPECT_EQ(codeOf(file->appendEntries(std::vector{relabelled})), StoreErrorCode::SeqGap);
  // The same batch again is refused too: repeating is the job of operation_id.
  EXPECT_EQ(codeOf(file->appendEntries(entries(1, 3))), StoreErrorCode::SeqGap);
  EXPECT_EQ(codeOf(file->appendEntries(entries(2, 5))), StoreErrorCode::SeqGap);
  EXPECT_EQ(loadedEntries(), jsonOf(entries(1, 3)));
  EXPECT_EQ(file->info().value().lastSeq, 3);
}

TEST_F(DocumentFileTest, ASeqBelow1IsInvalidAndWritesNothing) {
  for (const std::int64_t seq : {std::int64_t{0}, std::int64_t{-1}}) {
    SCOPED_TRACE(seq);
    std::vector<StoredEntry> batch = {anEntry(1), anEntry(seq)};
    EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::Invalid);
    EXPECT_TRUE(storedSeqs().empty());
    EXPECT_EQ(file->info().value().lastSeq, 0);
  }
}

TEST_F(DocumentFileTest, InvalidIsCheckedBeforeSeqGap) {
  std::vector<StoredEntry> batch = {anEntry(5), anEntry(0)};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::Invalid);
}

TEST_F(DocumentFileTest, AGapInsideTheBatchIsSeqGapAndWritesNoneOfIt) {
  std::vector<StoredEntry> batch = {anEntry(1), anEntry(2), anEntry(4)};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::SeqGap);
  EXPECT_TRUE(storedSeqs().empty());
  EXPECT_EQ(file->info().value().lastSeq, 0);
}

TEST_F(DocumentFileTest, EntriesOutOfOrderInsideTheBatchAreSeqGap) {
  std::vector<StoredEntry> batch = {anEntry(2), anEntry(1)};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::SeqGap);
  EXPECT_TRUE(storedSeqs().empty());
}

TEST_F(DocumentFileTest, AStoredOperationIdIsDuplicateOperationAndWritesNothing) {
  append({anEntry(1, OperationKey{"op-1", "fp"})});
  clock.time = 9000;
  std::vector<StoredEntry> batch = {anEntry(2, OperationKey{"op-2", "fp"}),
                                    anEntry(3, OperationKey{"op-1", "other"})};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::DuplicateOperation);
  EXPECT_EQ(storedSeqs(), std::vector<std::int64_t>{1});
  EXPECT_EQ(file->info().value().updatedAt, 1000);
}

TEST_F(DocumentFileTest, ADuplicateOperationIdInsideTheBatchIsDuplicateOperation) {
  std::vector<StoredEntry> batch = {anEntry(1, OperationKey{"op-1", "fp"}),
                                    anEntry(2, OperationKey{"op-1", "fp"})};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::DuplicateOperation);
  EXPECT_TRUE(storedSeqs().empty());
}

TEST_F(DocumentFileTest, SeqGapIsCheckedBeforeDuplicateOperation) {
  append({anEntry(1, OperationKey{"op-1", "fp"})});
  EXPECT_EQ(codeOf(file->appendEntries(std::vector{anEntry(3, OperationKey{"op-1", "fp"})})),
            StoreErrorCode::SeqGap);
}

TEST_F(DocumentFileTest, EntriesWithoutOperationIdDoNotCollide) {
  append(entries(1, 3));
  EXPECT_EQ(textValue(path(), "SELECT count(*) FROM operations WHERE operation_id IS NULL"), "3");
}

// --- the name of the document (M19.2, D5) -------------------------------------------------

TEST_F(DocumentFileTest, ABatchWithDocumentRenameSetsTheName) {
  clock.time = 2000;
  append({anEntry(1), anEntry(2, std::nullopt, testing::documentRenameOp("Part"))});
  const DocumentInfo info = file->info().value();
  EXPECT_EQ(info.meta.name, "Part");
  EXPECT_EQ(info.lastSeq, 2);
  EXPECT_EQ(info.updatedAt, 2000);
  EXPECT_EQ(catalog->list().value()[0].meta.name, "Part");
}

TEST_F(DocumentFileTest, TheLastDocumentRenameOfTheBatchWins) {
  append({anEntry(1, std::nullopt, testing::documentRenameOp("First")),
          anEntry(2, std::nullopt, testing::documentRenameOp("Second")), anEntry(3)});
  EXPECT_EQ(file->info().value().meta.name, "Second");
}

TEST_F(DocumentFileTest, ALaterBatchWithoutDocumentRenameKeepsTheName) {
  append({anEntry(1, std::nullopt, testing::documentRenameOp("Part"))});
  append(entries(2, 3));
  EXPECT_EQ(file->info().value().meta.name, "Part");
}

TEST_F(DocumentFileTest, ARejectedBatchWithDocumentRenameKeepsTheName) {
  std::vector<StoredEntry> batch = {anEntry(1),
                                    anEntry(3, std::nullopt, testing::documentRenameOp("Part"))};
  EXPECT_EQ(codeOf(file->appendEntries(batch)), StoreErrorCode::SeqGap);
  EXPECT_EQ(file->info().value().meta.name, "Doc d1");
}

TEST_F(DocumentFileTest, ADocumentRenameInsideABatchOperationDoesNotRename) {
  const Json batch = {{"type", "batch"}, {"v", 1}, {"ops", {testing::documentRenameOp("Inner")}}};
  append({anEntry(1, std::nullopt, batch)});
  EXPECT_EQ(file->info().value().meta.name, "Doc d1");
}

// --- saveSnapshot -------------------------------------------------------------------------

TEST_F(DocumentFileTest, LoadReturnsTheSnapshotWithTheHighestAtSeqAndTheBase) {
  append(entries(1, 3));
  ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2, "A2")).has_value());
  ASSERT_TRUE(file->saveSnapshot(3, aSnapshotJson("d1", 3, "A3")).has_value());
  ASSERT_TRUE(file->saveSnapshot(1, aSnapshotJson("d1", 1, "A1")).has_value());
  const StoredDocument loaded = file->load().value();
  EXPECT_EQ(loaded.snapshot, aSnapshotJson("d1", 3, "A3"));
  EXPECT_EQ(loaded.base, aSnapshotJson("d1", 0));
}

TEST_F(DocumentFileTest, AtSeqBeyondLastSeqIsSnapshotAheadAndWritesNothing) {
  append(entries(1, 2));
  EXPECT_EQ(codeOf(file->saveSnapshot(3, aSnapshotJson("d1", 3))), StoreErrorCode::SnapshotAhead);
  EXPECT_EQ(storedSnapshots(), std::vector<std::int64_t>{0});
}

TEST_F(DocumentFileTest, AtSeqBelow1IsInvalid) {
  append(entries(1, 3));
  for (const std::int64_t atSeq : {std::int64_t{0}, std::int64_t{-1}}) {
    EXPECT_EQ(codeOf(file->saveSnapshot(atSeq, aSnapshotJson("d1", atSeq))),
              StoreErrorCode::Invalid);
  }
  EXPECT_EQ(storedSnapshots(), std::vector<std::int64_t>{0});
  EXPECT_EQ(file->load().value().base, aSnapshotJson("d1", 0));
}

TEST_F(DocumentFileTest, ASnapshotOfAnotherDocumentIsInvalid) {
  append(entries(1, 2));
  EXPECT_EQ(codeOf(file->saveSnapshot(1, aSnapshotJson("d2", 1))), StoreErrorCode::Invalid);
  EXPECT_EQ(codeOf(file->saveSnapshot(1, Json{{"atSeq", 1}})), StoreErrorCode::Invalid);
  EXPECT_EQ(storedSnapshots(), std::vector<std::int64_t>{0});
}

TEST_F(DocumentFileTest, InvalidIsCheckedBeforeSnapshotAhead) {
  append(entries(1, 1));
  EXPECT_EQ(codeOf(file->saveSnapshot(3, aSnapshotJson("d2", 3))), StoreErrorCode::Invalid);
}

TEST_F(DocumentFileTest, SaveSnapshotDoesNotChangeUpdatedAt) {
  append(entries(1, 2));
  const double before = file->info().value().updatedAt;
  clock.time = 9000;
  ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2)).has_value());
  EXPECT_EQ(file->info().value().updatedAt, before);
}

TEST_F(DocumentFileTest, TheSameAtSeqOverwritesTheSnapshot) {
  append(entries(1, 2));
  ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2)).has_value());
  ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2, "Renamed")).has_value());
  EXPECT_EQ(file->load().value().snapshot, aSnapshotJson("d1", 2, "Renamed"));
}

TEST_F(DocumentFileTest, PruningKeepsTheBaseAndTheThreeHighestSnapshots) {
  append(entries(1, 8));
  for (std::int64_t n = 1; n <= 8; ++n) {
    ASSERT_TRUE(file->saveSnapshot(n, aSnapshotJson("d1", n)).has_value());
  }
  EXPECT_EQ(storedSnapshots(), (std::vector<std::int64_t>{0, 6, 7, 8}));
  // An older one written late is pruned at once.
  ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2)).has_value());
  EXPECT_EQ(storedSnapshots(), (std::vector<std::int64_t>{0, 6, 7, 8}));
  EXPECT_EQ(file->load().value().base, aSnapshotJson("d1", 0));
}

// --- load and findEntry -------------------------------------------------------------------

TEST_F(DocumentFileTest, LoadReturnsTheKeysOfTheEntries) {
  append({anEntry(1, OperationKey{"op-1", "fp-1"}), anEntry(2)});
  const StoredDocument loaded = file->load().value();
  ASSERT_TRUE(loaded.entries[0].operation.has_value());
  EXPECT_EQ(loaded.entries[0].operation->id, "op-1");
  EXPECT_EQ(loaded.entries[0].operation->fingerprint, "fp-1");
  EXPECT_EQ(loaded.entries[0].seq, 1);
  EXPECT_FALSE(loaded.entries[1].operation.has_value());
}

TEST_F(DocumentFileTest, FindEntryReturnsTheEntryWrittenForTheOperationId) {
  append({anEntry(1), anEntry(2, OperationKey{"op-2", "fp-2"})});
  const auto found = file->findEntry("op-2").value();
  ASSERT_TRUE(found.has_value());
  EXPECT_EQ(found->seq, 2);
  EXPECT_EQ(found->operation->fingerprint, "fp-2");
  EXPECT_EQ(found->entry, anEntry(2).entry);
  EXPECT_FALSE(file->findEntry("op-1").value().has_value());
  EXPECT_FALSE(file->findEntry("").value().has_value());
}

TEST_F(DocumentFileTest, BrokenJsonInTheFileIsIo) {
  append(entries(1, 1));
  {
    auto connection = sqlite::Connection::open(path(), false);
    ASSERT_TRUE(connection->exec("UPDATE operations SET entry = '{broken'").has_value());
  }
  auto loaded = file->load();
  ASSERT_FALSE(loaded.has_value());
  EXPECT_EQ(loaded.error().code, StoreErrorCode::Io);
}

TEST_F(DocumentFileTest, TwoDocumentsAreWrittenFromTwoThreadsAtOnce) {
  auto other = create("d2");
  const auto writeAll = [](DocumentFile& target) {
    for (std::int64_t seq = 1; seq <= 50; ++seq) {
      const StoredEntry entry = anEntry(seq, OperationKey{"op-" + std::to_string(seq), "fp"});
      ASSERT_TRUE(target.appendEntries(std::span(&entry, 1)).has_value());
    }
  };
  std::thread first([&] { writeAll(*file); });
  std::thread second([&] { writeAll(*other); });
  first.join();
  second.join();
  EXPECT_EQ(file->info().value().lastSeq, 50);
  EXPECT_EQ(other->info().value().lastSeq, 50);
  EXPECT_EQ(file->load().value().entries.size(), 50U);
}

}  // namespace
}  // namespace tinycad::storage
