// The SQLite catalog (port of the createDocument, listDocuments, deleteDocument and load rules of
// describeDocumentStoreContract in src/persistence/testing.ts, decisions N32, N34, N39) over real
// files in a temporary directory.

#include <gtest/gtest.h>

#include <fstream>
#include <string>

#include "storage/testing.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::storage {
namespace {

using testing::aSnapshotJson;
using testing::integerColumn;
using testing::metaOf;
using testing::textValue;

class CatalogTest : public ::testing::Test {
 protected:
  testing::TempDir dir;
  testing::ManualClock clock;
  std::unique_ptr<DocumentCatalog> catalog = openSqliteCatalog(dir.path(), clock.clock());

  std::unique_ptr<DocumentFile> created(const std::string& id,
                                        std::optional<OperationKey> key = std::nullopt) {
    auto file = catalog->create(metaOf(id), aSnapshotJson(id, 0), key);
    EXPECT_TRUE(file.has_value()) << (file ? "" : file.error().message);
    return file ? std::move(*file) : nullptr;
  }

  /** A created document with entries 1..count. */
  std::unique_ptr<DocumentFile> stored(const std::string& id, int count) {
    auto file = created(id);
    std::vector<StoredEntry> entries;
    for (int seq = 1; seq <= count; ++seq) entries.push_back(testing::anEntry(seq));
    EXPECT_TRUE(file->appendEntries(entries).has_value());
    return file;
  }

  std::vector<std::string> listedIds() {
    std::vector<std::string> ids;
    const auto list = catalog->list().value();
    for (const DocumentInfo& info : list) ids.push_back(info.meta.id.str());
    return ids;
  }

  [[nodiscard]] std::filesystem::path fileOf(const std::string& id) const {
    return dir.path() / (id + ".tinycad.sqlite");
  }
};

StoreErrorCode codeOf(const auto& result) {
  EXPECT_FALSE(result.has_value());
  return result ? StoreErrorCode::Io : result.error().code;
}

TEST(StoreErrorCodeName, NamesEveryCode) {
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::NotFound), "not-found");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::AlreadyExists), "already-exists");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::SeqGap), "seq-gap");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::SnapshotAhead), "snapshot-ahead");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::Invalid), "invalid");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::DuplicateOperation), "duplicate-operation");
  EXPECT_EQ(storeErrorCodeName(StoreErrorCode::Io), "io");
}

// --- create -------------------------------------------------------------------------------

TEST_F(CatalogTest, CreateListsTheNewDocumentWithLastSeq0AndUpdatedAtNow) {
  clock.time = 5000;
  created("d1");
  const auto list = catalog->list().value();
  ASSERT_EQ(list.size(), 1U);
  EXPECT_EQ(list[0].meta.id.str(), "d1");
  EXPECT_EQ(list[0].meta.name, "Doc d1");
  EXPECT_EQ(list[0].meta.createdAt, 0);
  EXPECT_EQ(list[0].lastSeq, 0);
  EXPECT_EQ(list[0].updatedAt, 5000);
}

TEST_F(CatalogTest, LoadReturnsTheInitialSnapshotAsBaseAndLatestWithNoEntries) {
  auto file = created("d1");
  const StoredDocument loaded = file->load().value();
  EXPECT_EQ(loaded.snapshot, aSnapshotJson("d1", 0));
  EXPECT_EQ(loaded.base, aSnapshotJson("d1", 0));
  EXPECT_TRUE(loaded.entries.empty());
}

TEST_F(CatalogTest, CreateKeepsAnExactDoubleCreatedAt) {
  DocumentMeta meta = metaOf("d1");
  meta.createdAt = 1700000000123.5;
  ASSERT_TRUE(catalog->create(meta, aSnapshotJson("d1", 0), std::nullopt).has_value());
  EXPECT_EQ(catalog->list().value()[0].meta.createdAt, 1700000000123.5);
}

TEST_F(CatalogTest, AnExistingIdIsAlreadyExistsAndKeepsTheOriginal) {
  stored("d1", 2);
  DocumentMeta other = metaOf("d1");
  other.name = "Other";
  EXPECT_EQ(codeOf(catalog->create(other, aSnapshotJson("d1", 0), std::nullopt)),
            StoreErrorCode::AlreadyExists);
  EXPECT_EQ(catalog->list().value()[0].meta.name, "Doc d1");
  EXPECT_EQ(catalog->open(document::DocumentId("d1")).value()->load().value().entries.size(), 2U);
}

TEST_F(CatalogTest, AlreadyExistsIsCheckedBeforeInvalid) {
  created("d1");
  EXPECT_EQ(codeOf(catalog->create(metaOf("d1"), aSnapshotJson("d1", 3), std::nullopt)),
            StoreErrorCode::AlreadyExists);
}

TEST_F(CatalogTest, InitialAtSeqOtherThan0IsInvalidAndCreatesNothing) {
  EXPECT_EQ(codeOf(catalog->create(metaOf("d1"), aSnapshotJson("d1", 1), std::nullopt)),
            StoreErrorCode::Invalid);
  EXPECT_TRUE(catalog->list().value().empty());
  EXPECT_EQ(codeOf(catalog->open(document::DocumentId("d1"))), StoreErrorCode::NotFound);
  EXPECT_TRUE(std::filesystem::is_empty(dir.path()));
}

TEST_F(CatalogTest, MetaIdDifferentFromTheSnapshotIsInvalid) {
  EXPECT_EQ(codeOf(catalog->create(metaOf("d1"), aSnapshotJson("d2", 0), std::nullopt)),
            StoreErrorCode::Invalid);
  EXPECT_TRUE(catalog->list().value().empty());
}

TEST_F(CatalogTest, UnsafeIdsAreInvalidForCreateAndNotFoundForOpenAndRemove) {
  for (const std::string& id :
       std::vector<std::string>{"../x", "a/b", "", std::string(65, 'a'), "a.b", "ä"}) {
    SCOPED_TRACE(id);
    EXPECT_EQ(codeOf(catalog->create(metaOf(id), aSnapshotJson(id, 0), std::nullopt)),
              StoreErrorCode::Invalid);
    EXPECT_EQ(codeOf(catalog->open(document::DocumentId(id))), StoreErrorCode::NotFound);
    EXPECT_EQ(codeOf(catalog->remove(document::DocumentId(id))), StoreErrorCode::NotFound);
  }
  EXPECT_TRUE(std::filesystem::is_empty(dir.path()));
  EXPECT_FALSE(std::filesystem::exists(dir.path().parent_path() / "x.tinycad.sqlite"));
}

TEST_F(CatalogTest, AnIdOf64SafeCharactersIsAccepted) {
  const std::string id = std::string(60, 'a') + "Z9_-";
  created(id);
  EXPECT_TRUE(catalog->open(document::DocumentId(id)).has_value());
}

TEST_F(CatalogTest, CreateWritesTheFileLayout) {
  created("d1", OperationKey{"op-1", "fp-1"});
  const auto file = fileOf("d1");
  EXPECT_EQ(integerColumn(file, "PRAGMA user_version"), std::vector<std::int64_t>{1});
  EXPECT_EQ(textValue(file, "PRAGMA journal_mode"), "wal");
  EXPECT_EQ(textValue(file, "SELECT value FROM meta WHERE key = 'format'"), "tinycad.sqlite");
  EXPECT_EQ(textValue(file, "SELECT value FROM meta WHERE key = 'document_id'"), "d1");
  EXPECT_EQ(textValue(file, "SELECT value FROM meta WHERE key = 'created_by_operation'"), "op-1");
  EXPECT_EQ(textValue(file, "SELECT value FROM meta WHERE key = 'created_by_fingerprint'"), "fp-1");
  EXPECT_EQ(integerColumn(file, "SELECT at_seq FROM snapshots"), std::vector<std::int64_t>{0});
  EXPECT_FALSE(std::filesystem::exists(file.string() + ".tmp"));
}

TEST_F(CatalogTest, ADocumentWithoutRequestHasNoCreatedByRows) {
  created("d1");
  EXPECT_EQ(textValue(fileOf("d1"),
                      "SELECT count(*) FROM meta WHERE key LIKE 'created_by_%'"),
            "0");
}

// --- list ---------------------------------------------------------------------------------

TEST_F(CatalogTest, ListIsEmptyForAnEmptyCatalog) { EXPECT_TRUE(catalog->list().value().empty()); }

TEST_F(CatalogTest, ListIsSortedByUpdatedAtNewestFirst) {
  clock.time = 1;
  auto a = created("a");
  clock.time = 2;
  created("b");
  clock.time = 3;
  created("c");
  clock.time = 4;
  const std::vector<StoredEntry> entries = {testing::anEntry(1)};
  ASSERT_TRUE(a->appendEntries(entries).has_value());
  std::vector<std::pair<std::string, double>> order;
  const auto list = catalog->list().value();
  for (const auto& info : list) order.emplace_back(info.meta.id.str(), info.updatedAt);
  EXPECT_EQ(order, (std::vector<std::pair<std::string, double>>{{"a", 4}, {"c", 3}, {"b", 2}}));
}

TEST_F(CatalogTest, ListIgnoresTemporaryFilesAndSkipsUnreadableOnes) {
  created("d1");
  std::ofstream(dir.path() / "half.tinycad.sqlite.tmp") << "half";
  std::ofstream(dir.path() / "broken.tinycad.sqlite") << "not a database";
  std::ofstream(dir.path() / "notes.txt") << "x";
  EXPECT_EQ(listedIds(), std::vector<std::string>{"d1"});
  EXPECT_FALSE(catalog->open(document::DocumentId("broken")).has_value());
}

TEST_F(CatalogTest, AFileOfAnotherFormatVersionIsIo) {
  created("d1");
  {
    auto connection = sqlite::Connection::open(fileOf("d1"), false);
    ASSERT_TRUE(connection->exec("PRAGMA user_version=2").has_value());
  }
  EXPECT_EQ(codeOf(catalog->open(document::DocumentId("d1"))), StoreErrorCode::Io);
  EXPECT_TRUE(catalog->list().value().empty());
}

// --- remove -------------------------------------------------------------------------------

TEST_F(CatalogTest, RemoveDeletesTheFileWithItsWal) {
  {
    auto file = stored("d1", 2);
    ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2)).has_value());
  }
  stored("d2", 1);
  ASSERT_TRUE(catalog->remove(document::DocumentId("d1")).has_value());
  EXPECT_EQ(codeOf(catalog->open(document::DocumentId("d1"))), StoreErrorCode::NotFound);
  EXPECT_EQ(listedIds(), std::vector<std::string>{"d2"});
  for (const char* suffix : {"", "-wal", "-shm"}) {
    EXPECT_FALSE(std::filesystem::exists(fileOf("d1").string() + suffix)) << suffix;
  }
  // Recreated under the same id, nothing of the old document comes back.
  auto again = created("d1");
  const StoredDocument loaded = again->load().value();
  EXPECT_TRUE(loaded.entries.empty());
  EXPECT_EQ(loaded.snapshot, aSnapshotJson("d1", 0));
  EXPECT_EQ(again->info().value().lastSeq, 0);
}

TEST_F(CatalogTest, RemoveKeepsOtherDocumentsIntact) {
  stored("d2", 2);
  stored("d1", 1);
  ASSERT_TRUE(catalog->remove(document::DocumentId("d1")).has_value());
  EXPECT_EQ(catalog->open(document::DocumentId("d2")).value()->load().value().entries.size(), 2U);
}

TEST_F(CatalogTest, RemovingAMissingIdSucceeds) {
  created("d1");
  EXPECT_TRUE(catalog->remove(document::DocumentId("missing")).has_value());
  EXPECT_TRUE(catalog->remove(document::DocumentId("missing")).has_value());
  EXPECT_EQ(catalog->list().value().size(), 1U);
}

// --- open ---------------------------------------------------------------------------------

TEST_F(CatalogTest, OpenOfAMissingIdIsNotFound) {
  EXPECT_EQ(codeOf(catalog->open(document::DocumentId("missing"))), StoreErrorCode::NotFound);
}

TEST_F(CatalogTest, AWrittenAndClosedFileReopensWithTheSameContent) {
  {
    auto file = created("d1");
    const std::vector<StoredEntry> entries = {testing::anEntry(1, OperationKey{"op-1", "fp-1"}),
                                              testing::anEntry(2)};
    ASSERT_TRUE(file->appendEntries(entries).has_value());
    ASSERT_TRUE(file->saveSnapshot(2, aSnapshotJson("d1", 2, "A2")).has_value());
  }
  // A new catalog: the counterpart of a restarted server.
  auto reopened = openSqliteCatalog(dir.path(), clock.clock())->open(document::DocumentId("d1"));
  ASSERT_TRUE(reopened.has_value());
  const StoredDocument loaded = (*reopened)->load().value();
  ASSERT_EQ(loaded.entries.size(), 2U);
  EXPECT_EQ(loaded.entries[0].entry, testing::anEntry(1).entry);
  ASSERT_TRUE(loaded.entries[0].operation.has_value());
  EXPECT_EQ(loaded.entries[0].operation->id, "op-1");
  EXPECT_EQ(loaded.entries[0].operation->fingerprint, "fp-1");
  EXPECT_FALSE(loaded.entries[1].operation.has_value());
  EXPECT_EQ(loaded.snapshot, aSnapshotJson("d1", 2, "A2"));
  EXPECT_EQ(loaded.base, aSnapshotJson("d1", 0));
  EXPECT_EQ((*reopened)->info().value().lastSeq, 2);
}

// --- findCreated --------------------------------------------------------------------------

TEST_F(CatalogTest, FindCreatedFindsTheDocumentAndTheKeyItWasCreatedWith) {
  created("d1");
  created("d2", OperationKey{"op-2", "fp-2"});
  const auto found = catalog->findCreated("op-2").value();
  ASSERT_TRUE(found.has_value());
  EXPECT_EQ(found->first.str(), "d2");
  EXPECT_EQ(found->second.id, "op-2");
  EXPECT_EQ(found->second.fingerprint, "fp-2");
  EXPECT_FALSE(catalog->findCreated("op-1").value().has_value());
}

TEST_F(CatalogTest, FindCreatedIsEmptyAfterTheDocumentIsRemoved) {
  created("d1", OperationKey{"op-1", "fp-1"});
  ASSERT_TRUE(catalog->remove(document::DocumentId("d1")).has_value());
  EXPECT_FALSE(catalog->findCreated("op-1").value().has_value());
}

}  // namespace
}  // namespace tinycad::storage
