// The `.tinycad.json` file (port of test/unit/persistence/file.test.ts without the store writes,
// which document_service_test.cpp covers): exportStoredJson and parseTinycadFile over JSON.
//
// Fixtures (fixtures/):
// - bracket-history.tinycad.json and bracket-history.stacks.json: written by TS
//   exportStoredDocument and UndoManager.stacks() from the 30-entry history of aStoredHistory in
//   test/unit/persistence/file.test.ts (renames, adds, a batch, undo, redo), via a throw-away
//   vitest test on 2026-10-17; formatted by Prettier.
// - old-part-v1.tinycad.json: the literal version 1 file (M4) of the same TS test.

#include "tinycad_file.hpp"

#include <gtest/gtest.h>

#include <fstream>
#include <sstream>

#include "ops/testing.hpp"
#include "snapshot.hpp"
#include "storage/testing.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using document::DocumentId;
using testing::OpsSession;

const DocumentId sourceId("src");

Json readFixture(const std::string& name) {
  std::ifstream in(std::string(TINYCAD_STORAGE_FIXTURES) + "/" + name);
  std::ostringstream text;
  text << in.rdbuf();
  return Json::parse(text.str());
}

std::unique_ptr<document::Document> aSourceDocument() {
  return testing::aDocument({.id = "src",
                             .name = "Bracket",
                             .createdAt = 5,
                             .features = {testing::aFeature({.id = "a", .name = "A"}),
                                          testing::aFeature({.id = "b", .name = "B"})},
                             .rollbackIndex = 1});
}

/** exportDocument of file.ts: the current state without history. */
Json exportDocument(const document::DocumentReader& doc) {
  return {{"format", "tinycad.file"}, {"formatVersion", 2}, {"snapshot", snapshotJson(doc, 0)}};
}

core::Result<CheckedFile, document::DocumentLoadError> parse(
    const Json& raw, const document::FeatureSchemaRegistryReader& schemas = testing::noSchemas()) {
  const ops::OpHandlerRegistry handlers(schemas);
  return parseTinycadFile(raw, schemas, handlers);
}

std::vector<std::string> issuePaths(const Json& raw) {
  auto result = parse(raw);
  EXPECT_FALSE(result.has_value()) << "expected the file not to load";
  std::vector<std::string> paths;
  if (result) return paths;
  for (const auto& issue : result.error().issues) paths.push_back(issue.path);
  return paths;
}

std::string firstMessage(const Json& raw) {
  auto result = parse(raw);
  return result || result.error().issues.empty() ? "" : result.error().issues[0].message;
}

Json fileWith(const Json& changes) {
  Json file = exportDocument(*aSourceDocument());
  for (const auto& [key, value] : changes.items()) file[key] = value;
  return file;
}

Json snapshotWith(const Json& changes) {
  Json snapshot = snapshotJson(*aSourceDocument(), 0);
  for (const auto& [key, value] : changes.items()) snapshot[key] = value;
  return snapshot;
}

/** aStoredHistory of file.test.ts: exactly 30 entries and a snapshot at 20. */
struct StoredHistory {
  std::unique_ptr<OpsSession> session;
  StoredDocument stored;
};

StoredHistory aStoredHistory() {
  StoredHistory history{std::make_unique<OpsSession>(testing::DocumentOptions{
                            .id = "src",
                            .name = "Bracket",
                            .createdAt = 5,
                            .features = {testing::aFeature({.id = "a", .name = "A"})}}),
                        {}};
  OpsSession& s = *history.session;
  history.stored.base = snapshotJson(*s.doc, 0);
  history.stored.snapshot = history.stored.base;
  const auto add = [](const std::string& id, int index) {
    std::string upper = id;
    for (char& c : upper) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return testing::addOp(*testing::aFeature({.id = id, .name = upper}), index);
  };
  int n = 0;
  while (s.log.lastSeq() < 30) {
    ++n;
    const std::string tag = std::to_string(n);
    switch (n % 6) {
      case 0: EXPECT_TRUE(s.dispatcher.dispatch(add("n" + tag, 1))); break;
      case 1:
        EXPECT_TRUE(s.dispatcher.dispatch(
            testing::batchOp(Json::array({testing::renameOp("a", "B" + tag), add("m" + tag, 0)}))));
        break;
      case 2: EXPECT_TRUE(s.undo.undo()); break;
      case 3: EXPECT_TRUE(s.undo.redo()); break;
      case 4: EXPECT_TRUE(s.undo.undo()); break;
      default: EXPECT_TRUE(s.dispatcher.dispatch(testing::renameOp("a", "A" + tag)));
    }
    if (s.log.lastSeq() == 20) history.stored.snapshot = snapshotJson(*s.doc, 20);
  }
  for (const auto& entry : s.log.entries()) {
    history.stored.entries.push_back(StoredEntry{entry.seq, std::nullopt, ops::logEntryJson(entry)});
  }
  return history;
}

Json exported(const StoredDocument& stored) {
  const ops::OpHandlerRegistry handlers(testing::noSchemas());
  auto result = exportStoredJson(stored, sourceId, testing::noSchemas(), handlers);
  EXPECT_TRUE(result.has_value()) << (result ? "" : result.error().message);
  return result ? *result : Json();
}

std::vector<Json> entriesJson(const std::vector<ops::LogEntry>& entries) {
  std::vector<Json> out;
  for (const auto& entry : entries) out.push_back(ops::logEntryJson(entry));
  return out;
}

// --- exportStoredJson ---------------------------------------------------------------------

TEST(ExportStoredJson, ExportsTheStoredStateTheBaseSnapshotAndTheWholeLog) {
  const StoredHistory history = aStoredHistory();
  const Json file = exported(history.stored);
  EXPECT_EQ(file["format"], "tinycad.file");
  EXPECT_EQ(file["formatVersion"], 2);
  EXPECT_EQ(file["snapshot"], snapshotJson(*history.session->doc, 30));
  EXPECT_EQ(file["history"]["base"]["atSeq"], 0);
  ASSERT_EQ(file["history"]["base"]["document"]["studio"]["features"].size(), 1U);
  EXPECT_EQ(file["history"]["base"]["document"]["studio"]["features"][0]["name"], "A");
  EXPECT_EQ(file["history"]["entries"].get<std::vector<Json>>(),
            entriesJson(history.session->log.entries()));
  EXPECT_EQ(Json::parse(file.dump()), file);
}

TEST(ExportStoredJson, IsTheFileTsWritesForTheSameHistory) {
  EXPECT_EQ(exported(aStoredHistory().stored), readFixture("bracket-history.tinycad.json"));
}

TEST(ExportStoredJson, AnEmptyLogExportsAnEmptyHistory) {
  const auto doc = aSourceDocument();
  StoredDocument stored;
  stored.base = snapshotJson(*doc, 0);
  stored.snapshot = stored.base;
  const Json file = exported(stored);
  EXPECT_EQ(file["snapshot"], snapshotJson(*doc, 0));
  EXPECT_EQ(file["history"], (Json{{"base", snapshotJson(*doc, 0)}, {"entries", Json::array()}}));
}

TEST(ExportStoredJson, ABrokenBaseSnapshotIsABaseError) {
  StoredHistory history = aStoredHistory();
  history.stored.base = {{"format", "x"}};
  const ops::OpHandlerRegistry handlers(testing::noSchemas());
  auto result = exportStoredJson(history.stored, sourceId, testing::noSchemas(), handlers);
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().kind, LoadError::Kind::Base);
}

// --- parseTinycadFile without history -----------------------------------------------------

TEST(ParseTinycadFile, ARoundTripThroughTextGivesTheSameData) {
  const auto source = aSourceDocument();
  auto checked = parse(Json::parse(exportDocument(*source).dump()));
  ASSERT_TRUE(checked.has_value());
  EXPECT_EQ(document::documentDataJson(checked->state),
            document::documentDataJson(document::toData(*source)));
  EXPECT_EQ(checked->base.studio, checked->state.studio);
  EXPECT_TRUE(checked->entries.empty());
}

TEST(ParseTinycadFile, MigratesFeaturesOfAnOlderTypeVersion) {
  document::FeatureSchemaRegistry schemas;
  schemas.add(std::make_shared<testing::TestSchema>(
      "box", 2, document::ParamSchema{},
      [](int, const Json& raw) -> core::Result<Json, std::string> {
        return Json{{"width", raw.at("size")}};
      }));
  const auto source =
      testing::aDocument({.features = {testing::aFeature({.id = "a", .params = Json{{"size", 7}}})}});
  auto checked = parse(exportDocument(*source), schemas);
  ASSERT_TRUE(checked.has_value());
  EXPECT_EQ(checked->state.studio->features[0]->typeVersion, 2);
  EXPECT_EQ(*checked->state.studio->features[0]->params, (Json{{"width", 7}}));
}

TEST(ParseTinycadFile, RejectsABrokenFile) {
  EXPECT_EQ(issuePaths("nope"), std::vector<std::string>{""});
  EXPECT_EQ(issuePaths(fileWith({{"format", "tinycad.snapshot"}})), std::vector<std::string>{"format"});
  EXPECT_EQ(issuePaths(fileWith({{"formatVersion", 3}})), std::vector<std::string>{"formatVersion"});
  EXPECT_NE(firstMessage(fileWith({{"formatVersion", 3}})).find("newer"), std::string::npos);
  EXPECT_EQ(issuePaths(fileWith({{"formatVersion", "1"}})), std::vector<std::string>{"formatVersion"});
  EXPECT_EQ(firstMessage(fileWith({{"formatVersion", "1"}})), "Must be 1 or 2");
  Json missing = exportDocument(*aSourceDocument());
  missing.erase("snapshot");
  EXPECT_EQ(issuePaths(missing), std::vector<std::string>{"snapshot"});
  EXPECT_EQ(issuePaths(fileWith({{"snapshot", snapshotWith({{"format", "x"}, {"formatVersion", 3}})}})),
            (std::vector<std::string>{"snapshot.format", "snapshot.formatVersion"}));
  EXPECT_EQ(issuePaths(fileWith({{"snapshot", snapshotWith({{"atSeq", 3}})}})),
            std::vector<std::string>{"snapshot.atSeq"});
  const Json document = {{"meta", {{"id", "x"}, {"name", "X"}, {"createdAt", 0}}}, {"studio", 42}};
  EXPECT_EQ(issuePaths(fileWith({{"snapshot", snapshotWith({{"document", document}})}})),
            std::vector<std::string>{"snapshot.document.studio"});
}

TEST(ParseTinycadFile, LoadsALiteralVersion1File) {
  auto checked = parse(readFixture("old-part-v1.tinycad.json"));
  ASSERT_TRUE(checked.has_value());
  EXPECT_EQ(checked->state.meta.name, "Old part");
  ASSERT_EQ(checked->state.studio->features.size(), 1U);
  EXPECT_EQ(checked->state.studio->features[0]->name, "A");
  EXPECT_EQ(*checked->state.studio->features[0]->params, (Json{{"size", 2}}));
  EXPECT_EQ(checked->state.studio->rollbackIndex, 1);
}

TEST(ParseTinycadFile, AVersion1FileWithHistoryIsReadWithoutIt) {
  Json file = readFixture("old-part-v1.tinycad.json");
  file["history"] = "ignored, even broken";
  auto checked = parse(file);
  ASSERT_TRUE(checked.has_value());
  EXPECT_TRUE(checked->entries.empty());
}

// --- parseTinycadFile with history --------------------------------------------------------

TEST(ParseTinycadFileWithHistory, ARoundTripKeepsTheStateAndTheUndoStacks) {
  const StoredHistory history = aStoredHistory();
  auto checked = parse(Json::parse(exported(history.stored).dump()));
  ASSERT_TRUE(checked.has_value());
  EXPECT_TRUE(document::sameStudio(*checked->state.studio, *history.session->doc->studio()));
  EXPECT_EQ(entriesJson(checked->entries), entriesJson(history.session->log.entries()));
  EXPECT_EQ(ops::rebuildUndoStacks(checked->entries).value(), history.session->undo.stacks());
  EXPECT_EQ(checked->base.studio->features.size(), 1U);
}

TEST(ParseTinycadFileWithHistory, ReadsTheFileTsWrote) {
  auto checked = parse(readFixture("bracket-history.tinycad.json"));
  ASSERT_TRUE(checked.has_value());
  EXPECT_EQ(checked->entries.size(), 30U);
  const Json stacks = readFixture("bracket-history.stacks.json");
  const ops::UndoStacks rebuilt = ops::rebuildUndoStacks(checked->entries).value();
  EXPECT_EQ(rebuilt.undo, stacks["undo"].get<std::vector<std::int64_t>>());
  EXPECT_EQ(rebuilt.redo, stacks["redo"].get<std::vector<std::int64_t>>());
}

class BrokenHistory : public ::testing::Test {
 protected:
  Json file = exported(aStoredHistory().stored);
};

TEST_F(BrokenHistory, HistoryNotAnObject) {
  file["history"] = Json::array();
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history"});
}

TEST_F(BrokenHistory, BaseWithAtSeq1) {
  file["history"]["base"]["atSeq"] = 1;
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history.base.atSeq"});
}

TEST_F(BrokenHistory, EntriesNotAnArray) {
  file["history"]["entries"] = Json::object();
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history.entries"});
}

TEST_F(BrokenHistory, AGapInSeq) {
  file["history"]["entries"].erase(4);
  file["snapshot"]["atSeq"] = file["history"]["entries"].size();
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history.entries[4].seq"});
}

TEST_F(BrokenHistory, ABrokenOperationInAnEntry) {
  file["history"]["entries"][3]["op"] = {{"type", "nope"}, {"v", 1}};
  const auto paths = issuePaths(file);
  ASSERT_EQ(paths.size(), 1U);
  EXPECT_TRUE(paths[0].starts_with("history.entries[3].op")) << paths[0];
}

TEST_F(BrokenHistory, AnEntryTheHandlerRejects) {
  file["history"]["entries"][0]["op"] = testing::renameOp("missing", "X");
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history.entries[0]"});
}

TEST_F(BrokenHistory, AnUndoEntryThatDoesNotTargetTheTopOfTheStack) {
  // Entry 2 is the undo of entry 1; as a redo it targets an empty redo stack. Replay applies only
  // `op`, so only rebuildUndoStacks notices.
  ASSERT_EQ(file["history"]["entries"][1]["kind"], "undo");
  file["history"]["entries"][1]["kind"] = "redo";
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history.entries"});
}

TEST_F(BrokenHistory, SnapshotAtSeqOtherThanTheNumberOfEntries) {
  file["snapshot"]["atSeq"] = 29;
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"snapshot.atSeq"});
}

TEST_F(BrokenHistory, AForgedSnapshotThatTheHistoryDoesNotProduce) {
  file["snapshot"]["document"]["studio"] = {
      {"features", Json::array({testing::featureJson(*testing::aFeature({.id = "forged", .name = "Forged"}))})},
      {"rollbackIndex", 1}};
  EXPECT_EQ(issuePaths(file), std::vector<std::string>{"history"});
  EXPECT_EQ(firstMessage(file), "Replayed history does not match the snapshot");
}

}  // namespace
}  // namespace tinycad::storage
