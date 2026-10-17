// DocumentService (spec 14 "DocumentService", spec 05 "Export a import souboru", decisions N37,
// N39): the catalog as an application service over real SQLite files.

#include "tinycad/storage/document_service.hpp"

#include <gtest/gtest.h>

#include <fstream>
#include <sstream>

#include "failing_file.hpp"
#include "ops/testing.hpp"
#include "snapshot.hpp"
#include "storage/testing.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using document::DocumentId;

std::string readFixture(const std::string& name) {
  std::ifstream in(std::string(TINYCAD_STORAGE_FIXTURES) + "/" + name);
  std::ostringstream text;
  text << in.rdbuf();
  return text.str();
}

class DocumentServiceTest : public ::testing::Test {
 protected:
  testing::TempDir dir;
  testing::ManualClock clock;
  std::unique_ptr<DocumentCatalog> catalog = openSqliteCatalog(dir.path(), clock.clock());
  std::shared_ptr<testing::FailSwitches> fail = std::make_shared<testing::FailSwitches>();
  testing::FailingCatalog failing{*catalog, fail};
  int nextId = 0;
  DocumentService service{{failing, testing::serverSchemas(), testing::serverHandlers(),
                           clock.clock(), [this] { return "doc" + std::to_string(++nextId); }}};
  int keys = 0;

  OperationKey key() {
    ++keys;
    return {"op-" + std::to_string(keys), "fp-" + std::to_string(keys)};
  }

  std::unique_ptr<PersistentDocument> open(const DocumentId& id) {
    const PersistentDocument::Dependencies deps{testing::serverSchemas(), testing::serverHandlers(),
                                                clock.clock(), true};
    auto doc = PersistentDocument::open(catalog->open(id).value(), deps);
    EXPECT_TRUE(doc.has_value()) << (doc ? "" : doc.error().message);
    return doc ? std::move(*doc) : nullptr;
  }

  std::vector<std::string> listedNames() {
    std::vector<std::string> names;
    const auto list = service.list().value();
    for (const auto& summary : list) names.push_back(summary.name);
    return names;
  }
};

std::vector<std::string> issuePaths(const ServiceError& error) {
  std::vector<std::string> paths;
  for (const auto& issue : error.issues) paths.push_back(issue.path);
  return paths;
}

// --- list and create ----------------------------------------------------------------------

TEST_F(DocumentServiceTest, ListIsEmptyAtFirst) { EXPECT_TRUE(service.list().value().empty()); }

TEST_F(DocumentServiceTest, CreateMakesAnEmptyDocumentWithABaseSnapshot) {
  clock.time = 7000;
  const auto summary = service.create("  Bracket \t", key()).value();
  EXPECT_EQ(summary.id.str(), "doc1");
  EXPECT_EQ(summary.name, "Bracket");
  EXPECT_EQ(summary.createdAt, 7000);
  EXPECT_EQ(summary.updatedAt, 7000);
  const StoredDocument stored = catalog->open(summary.id).value()->load().value();
  EXPECT_TRUE(stored.entries.empty());
  EXPECT_EQ(stored.base["atSeq"], 0);
  EXPECT_EQ(stored.base["document"]["meta"],
            (Json{{"id", "doc1"}, {"name", "Bracket"}, {"createdAt", 7000}}));
  EXPECT_EQ(stored.base["document"]["studio"], (Json{{"features", Json::array()}, {"rollbackIndex", 0}}));
  auto doc = open(summary.id);
  EXPECT_EQ(doc->document().studio()->features.size(), 0U);
}

TEST_F(DocumentServiceTest, CreateTrimsUnicodeSpacesAsTheUi) {
  EXPECT_EQ(service.create("\xC2\xA0Part\xE3\x80\x80", key()).value().name, "Part");
}

TEST_F(DocumentServiceTest, AnEmptyNameIsInvalidNameAndCreatesNothing) {
  for (const std::string name : {"", "   ", "\n\xC2\xA0"}) {
    auto created = service.create(name, key());
    ASSERT_FALSE(created.has_value());
    EXPECT_EQ(created.error().code, ServiceErrorCode::InvalidName);
  }
  EXPECT_TRUE(service.list().value().empty());
  EXPECT_EQ(nextId, 0);
}

TEST_F(DocumentServiceTest, ListIsSortedByUpdatedAtNewestFirst) {
  clock.time = 1;
  const auto a = service.create("A", key()).value();
  clock.time = 2;
  service.create("B", key()).value();
  clock.time = 3;
  ASSERT_TRUE(service.rename(a.id, "A2", key()));
  EXPECT_EQ(listedNames(), (std::vector<std::string>{"A2", "B"}));
  const auto list = service.list().value();
  EXPECT_EQ(list[0].updatedAt, 3);
  EXPECT_EQ(list[0].createdAt, 1);
}

// --- rename and remove --------------------------------------------------------------------

TEST_F(DocumentServiceTest, RenameAppendsDocumentRenameToTheLogOfAClosedDocument) {
  const auto created = service.create("Part", key()).value();
  const auto renamed = service.rename(created.id, " Bracket ", key()).value();
  EXPECT_EQ(renamed.name, "Bracket");
  EXPECT_EQ(listedNames(), std::vector<std::string>{"Bracket"});
  const StoredDocument stored = catalog->open(created.id).value()->load().value();
  ASSERT_EQ(stored.entries.size(), 1U);
  EXPECT_EQ(stored.entries[0].entry["op"],
            (Json{{"type", "document.rename"}, {"v", 1}, {"name", "Bracket"}}));
  EXPECT_EQ(stored.entries[0].entry["label"], "document.rename");
  auto doc = open(created.id);
  EXPECT_EQ(doc->document().meta().name, "Bracket");
  EXPECT_FALSE(doc->canUndo());  // the name is outside undo (M19.2)
}

TEST_F(DocumentServiceTest, RenameErrors) {
  const auto created = service.create("Part", key()).value();
  auto empty = service.rename(created.id, "  ", key());
  ASSERT_FALSE(empty.has_value());
  EXPECT_EQ(empty.error().code, ServiceErrorCode::InvalidName);
  auto missing = service.rename(DocumentId("missing"), "X", key());
  ASSERT_FALSE(missing.has_value());
  EXPECT_EQ(missing.error().code, ServiceErrorCode::NotFound);
  fail->append = true;
  ::testing::internal::CaptureStderr();
  auto failed = service.rename(created.id, "X", key());
  (void)::testing::internal::GetCapturedStderr();
  ASSERT_FALSE(failed.has_value());
  EXPECT_EQ(failed.error().code, ServiceErrorCode::Storage);
  EXPECT_EQ(listedNames(), std::vector<std::string>{"Part"});
}

TEST_F(DocumentServiceTest, RenameOfABrokenDocumentIsBrokenDocument) {
  const auto created = service.create("Part", key()).value();
  {
    auto file = catalog->open(created.id).value();
    const StoredEntry broken{1, std::nullopt,
                             testing::anEntryJson(1, testing::renameOp("missing", "X"))};
    ASSERT_TRUE(file->appendEntries(std::span(&broken, 1)));
  }
  auto renamed = service.rename(created.id, "X", key());
  ASSERT_FALSE(renamed.has_value());
  EXPECT_EQ(renamed.error().code, ServiceErrorCode::BrokenDocument);
}

TEST_F(DocumentServiceTest, RemoveDeletesTheDocumentAndAMissingIdSucceeds) {
  const auto a = service.create("A", key()).value();
  service.create("B", key()).value();
  ASSERT_TRUE(service.remove(a.id));
  EXPECT_EQ(listedNames(), std::vector<std::string>{"B"});
  EXPECT_TRUE(service.remove(a.id));
  EXPECT_TRUE(service.remove(DocumentId("../etc")));
}

// --- import and export --------------------------------------------------------------------

TEST_F(DocumentServiceTest, ImportsAVersion1File) {
  clock.time = 1700000000000;
  const auto imported = service.importFile(readFixture("old-part-v1.tinycad.json"), key()).value();
  EXPECT_EQ(imported.id.str(), "doc1");
  EXPECT_EQ(imported.name, "Old part");
  EXPECT_EQ(imported.createdAt, 1700000000000);
  auto doc = open(imported.id);
  EXPECT_EQ(doc->document().meta().id.str(), "doc1");
  EXPECT_EQ(doc->document().meta().createdAt, 1700000000000);
  EXPECT_EQ(doc->log().lastSeq(), 0);
  EXPECT_EQ(*doc->document().studio()->features[0]->params, (Json{{"size", 2}}));
}

TEST_F(DocumentServiceTest, ImportsAFileWithHistoryAndKeepsTheUndoStacks) {
  const auto imported = service.importFile(readFixture("bracket-history.tinycad.json"), key()).value();
  EXPECT_EQ(imported.name, "Bracket");
  const StoredDocument stored = catalog->open(imported.id).value()->load().value();
  EXPECT_EQ(stored.entries.size(), 30U);
  EXPECT_FALSE(stored.entries[0].operation.has_value());
  EXPECT_EQ(stored.snapshot["atSeq"], 30);
  EXPECT_EQ(stored.snapshot["document"]["meta"]["id"], imported.id.str());
  EXPECT_EQ(stored.base["document"]["meta"]["id"], imported.id.str());
  auto doc = open(imported.id);  // with verify: base + log == snapshot
  const Json stacks = Json::parse(readFixture("bracket-history.stacks.json"));
  const ops::UndoStacks rebuilt = ops::rebuildUndoStacks(doc->log().entries());
  EXPECT_EQ(rebuilt.undo, stacks["undo"].get<std::vector<std::int64_t>>());
  EXPECT_TRUE(doc->canUndo());
}

TEST_F(DocumentServiceTest, ABrokenFileIsInvalidDocumentAndStoresNothing) {
  auto notJson = service.importFile("{broken", key());
  ASSERT_FALSE(notJson.has_value());
  EXPECT_EQ(notJson.error().code, ServiceErrorCode::InvalidDocument);
  EXPECT_EQ(issuePaths(notJson.error()), std::vector<std::string>{""});

  Json file = Json::parse(readFixture("bracket-history.tinycad.json"));
  file["snapshot"]["atSeq"] = 29;
  auto broken = service.importFile(file.dump(), key());
  ASSERT_FALSE(broken.has_value());
  EXPECT_EQ(broken.error().code, ServiceErrorCode::InvalidDocument);
  EXPECT_EQ(issuePaths(broken.error()), std::vector<std::string>{"snapshot.atSeq"});
  EXPECT_TRUE(service.list().value().empty());
  EXPECT_TRUE(std::filesystem::is_empty(dir.path()));
}

TEST_F(DocumentServiceTest, AFailureAfterCreateRemovesTheHalfDocument) {
  fail->append = true;
  auto imported = service.importFile(readFixture("bracket-history.tinycad.json"), key());
  ASSERT_FALSE(imported.has_value());
  EXPECT_EQ(imported.error().code, ServiceErrorCode::Storage);
  EXPECT_EQ(fail->appendCalls, 1);
  EXPECT_TRUE(service.list().value().empty());
}

TEST_F(DocumentServiceTest, AFailedCleanupIsSwallowedAndTheOriginalErrorReturned) {
  fail->snapshot = true;
  fail->remove = true;
  auto imported = service.importFile(readFixture("bracket-history.tinycad.json"), key());
  ASSERT_FALSE(imported.has_value());
  EXPECT_EQ(imported.error().code, ServiceErrorCode::Storage);
  EXPECT_NE(imported.error().message.find("injected"), std::string::npos);
}

TEST_F(DocumentServiceTest, ExportThenImportGivesTheSameDocumentAndUndo) {
  const auto created = service.create("A/B: c", key()).value();
  {
    auto doc = open(created.id);
    ASSERT_TRUE(doc->dispatch(testing::addOp(*testing::aFeature({.id = "a", .name = "A"}), 0), "", key()));
    ASSERT_TRUE(doc->begin("T"));
    ASSERT_TRUE(doc->apply(testing::renameOp("a", "B")));
    ASSERT_TRUE(doc->apply(testing::suppressOp("a", true)));
    ASSERT_TRUE(doc->commit(key()));
    ASSERT_TRUE(doc->undo(key()));
  }
  const ExportedFile exported = service.exportFile(created.id).value();
  EXPECT_EQ(exported.fileName, "A_B_ c.tinycad.json");
  const Json content = Json::parse(exported.content);
  EXPECT_EQ(content["formatVersion"], 2);
  EXPECT_EQ(content["history"]["entries"].size(), 3U);

  const auto imported = service.importFile(exported.content, key()).value();
  EXPECT_NE(imported.id, created.id);
  auto original = open(created.id);
  auto copy = open(imported.id);
  EXPECT_TRUE(document::sameStudio(*copy->document().studio(), *original->document().studio()));
  EXPECT_EQ(copy->document().meta().name, "A/B: c");
  EXPECT_EQ(ops::rebuildUndoStacks(copy->log().entries()),
            ops::rebuildUndoStacks(original->log().entries()));
  EXPECT_TRUE(copy->canRedo());
}

TEST_F(DocumentServiceTest, ExportErrors) {
  auto missing = service.exportFile(DocumentId("missing"));
  ASSERT_FALSE(missing.has_value());
  EXPECT_EQ(missing.error().code, ServiceErrorCode::NotFound);

  const auto created = service.create("Part", key()).value();
  {
    auto file = catalog->open(created.id).value();
    const StoredEntry broken{1, std::nullopt,
                             testing::anEntryJson(1, testing::renameOp("missing", "X"))};
    ASSERT_TRUE(file->appendEntries(std::span(&broken, 1)));
  }
  auto brokenExport = service.exportFile(created.id);
  ASSERT_FALSE(brokenExport.has_value());
  EXPECT_EQ(brokenExport.error().code, ServiceErrorCode::BrokenDocument);
}

TEST_F(DocumentServiceTest, ExportFileNamesAreSafe) {
  for (const auto& [name, expected] : std::vector<std::pair<std::string, std::string>>{
           {"..hidden..", "hidden.tinycad.json"},
           {"a*b?c", "a_b_c.tinycad.json"},
           {" . ", "tinycad.tinycad.json"},
           {std::string(120, 'x'), std::string(100, 'x') + ".tinycad.json"}}) {
    const auto created = service.create(name, key()).value();
    EXPECT_EQ(service.exportFile(created.id).value().fileName, expected) << name;
  }
}

}  // namespace
}  // namespace tinycad::storage
