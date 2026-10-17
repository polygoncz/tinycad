// loadDocument over StoredDocument (port of test/unit/persistence/load.test.ts without
// PersistenceService and the store I/O case, which PersistentDocument covers): no SQLite here.

#include "load.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <memory>

#include "ops/testing.hpp"
#include "storage/testing.hpp"
#include "snapshot.hpp"
#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/replay.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::storage {
namespace {

using core::Json;
using document::DocumentId;
using document::FeatureId;
using testing::OpsSession;

const DocumentId id("d1");

std::unique_ptr<OpsSession> aSession(const document::FeatureSchemaRegistryReader& schemas =
                                         testing::noSchemas()) {
  return std::make_unique<OpsSession>(
      testing::DocumentOptions{.id = "d1",
                               .name = "Doc",
                               .features = {testing::aFeature({.id = "a", .name = "A"})}},
      schemas);
}

void dispatch(OpsSession& s, const Json& op) {
  auto entry = s.dispatcher.dispatch(op);
  ASSERT_TRUE(entry.has_value()) << entry.error().path << ": " << entry.error().message;
}

StoredEntry storedEntry(const ops::LogEntry& entry) {
  return StoredEntry{entry.seq, std::nullopt, ops::logEntryJson(entry)};
}

/** StoredDocument as a store returns it: the base, every entry of the log and the latest snapshot. */
StoredDocument storedOf(const Json& base, const ops::OperationLog& log,
                        const Json& latest) {
  StoredDocument stored;
  stored.base = base;
  stored.snapshot = latest;
  for (const ops::LogEntry& entry : log.entries()) stored.entries.push_back(storedEntry(entry));
  return stored;
}

/** A session with `count` renames of 'a' and its stored data with the snapshot at `snapshotAt`. */
struct StoredSession {
  std::unique_ptr<OpsSession> session;
  StoredDocument stored;
};

StoredSession aStoredSession(int count, int snapshotAt = 0) {
  StoredSession result{aSession(), {}};
  OpsSession& s = *result.session;
  const Json base = snapshotJson(*s.doc, 0);
  std::optional<Json> latest;
  for (int n = 1; n <= count; ++n) {
    dispatch(s, testing::renameOp("a", "A" + std::to_string(n)));
    if (n == snapshotAt) latest = snapshotJson(*s.doc, n);
  }
  result.stored = storedOf(base, s.log, latest.value_or(base));
  return result;
}

LoadedDocument loaded(const StoredDocument& stored, bool verify = true,
                      const document::FeatureSchemaRegistryReader& schemas = testing::noSchemas()) {
  const ops::OpHandlerRegistry handlers(schemas);
  auto result = loadDocument(stored, id, schemas, handlers, verify);
  EXPECT_TRUE(result.has_value()) << (result ? "" : result.error().message);
  if (!result) return {};
  return std::move(*result);
}

LoadError loadError(const StoredDocument& stored, bool verify = true) {
  const ops::OpHandlerRegistry handlers(testing::noSchemas());
  auto result = loadDocument(stored, id, testing::noSchemas(), handlers, verify);
  EXPECT_FALSE(result.has_value()) << "expected the document not to load";
  if (result) return {};
  return result.error();
}

std::vector<std::string> pathsOf(const LoadError& error) {
  std::vector<std::string> paths;
  for (const auto& issue : error.issues) paths.push_back(issue.path);
  return paths;
}

std::vector<Json> jsonOf(const std::vector<ops::LogEntry>& entries) {
  std::vector<Json> out;
  for (const auto& entry : entries) out.push_back(ops::logEntryJson(entry));
  return out;
}

/**
 * Drives a live session to exactly `total` log entries with a mix of every operation type and some
 * undo/redo (runMixedHistory of load.test.ts). The last entry is a 'do' renaming the returned
 * feature to 'last', so undo afterwards reverts a real operation.
 */
FeatureId runMixedHistory(OpsSession& s, std::int64_t total) {
  int added = 0;
  while (s.log.lastSeq() < total - 1) {
    const std::int64_t step = s.log.lastSeq() + 1;
    const auto studio = s.doc->studio();
    const auto& features = studio->features;
    const auto count = static_cast<int>(features.size());
    const std::string first = features.front()->id.str();
    const document::FeaturePtr last = features.back();
    const std::string tag = std::to_string(step);
    switch (step % 10) {
      case 1:
      case 9:
        ++added;
        dispatch(s, testing::addOp(*testing::aFeature({.id = "n" + std::to_string(added),
                                                        .name = "N" + std::to_string(added)}),
                                   std::min(1, count)));
        break;
      case 2: dispatch(s, testing::renameOp(first, "A" + tag)); break;
      case 3:
        if (s.undo.canUndo()) {
          EXPECT_TRUE(s.undo.undo().has_value());
        } else {
          dispatch(s, testing::renameOp(first, "U" + tag));
        }
        break;
      case 4:
        if (s.undo.canRedo()) {
          EXPECT_TRUE(s.undo.redo().has_value());
        } else {
          dispatch(s, testing::renameOp(first, "R" + tag));
        }
        break;
      case 5: dispatch(s, testing::setParamsOp(last->id.str(), {{"size", step}})); break;
      case 6: dispatch(s, testing::suppressOp(last->id.str(), !last->suppressed)); break;
      case 7: dispatch(s, testing::moveOp(first, count - 1)); break;
      case 8: dispatch(s, testing::rollbackOp(step % 20 == 8 ? count - 1 : count)); break;
      default:
        if (count > 2) {
          dispatch(s, testing::removeOp(last->id.str()));
        } else {
          dispatch(s, testing::renameOp(first, "X" + tag));
        }
    }
  }
  const FeatureId target = s.doc->studio()->features.front()->id;
  dispatch(s, testing::renameOp(target.str(), "last"));
  return target;
}

TEST(LoadDocument, TwoHundredFiftyOperationsLoadToTheSameDocumentAndUndoRevertsTheLastOne) {
  auto live = aSession();
  const Json base = snapshotJson(*live->doc, 0);
  std::optional<Json> latest;
  const FeatureId renamed = runMixedHistory(*live, 250);
  ASSERT_EQ(live->log.lastSeq(), 250);
  std::vector<bool> kinds(3, false);
  for (const auto& entry : live->log.entries()) kinds[static_cast<std::size_t>(entry.kind)] = true;
  EXPECT_EQ(kinds, std::vector<bool>(3, true)) << "do, undo and redo entries";

  // Snapshots at 100 and 200 as PersistentDocument writes them, replayed from the base.
  auto replay = aSession();
  const auto all = live->log.entries();
  for (const auto& entry : all) {
    ASSERT_TRUE(ops::replayLog(*replay->doc, replay->handlers, {entry}).has_value());
    if (entry.seq == 200) latest = snapshotJson(*replay->doc, 200);
  }
  const StoredDocument stored = storedOf(base, live->log, latest.value_or(base));

  LoadedDocument opened = loaded(stored, false);
  ASSERT_NE(opened.doc, nullptr);
  EXPECT_TRUE(sameDocumentData(*opened.doc, *live->doc));
  EXPECT_EQ(jsonOf(opened.entries), jsonOf(all));

  // Only the 50 entries after the snapshot are replayed: entries before it may be unreplayable.
  StoredDocument tampered = stored;
  for (std::size_t i = 0; i < 200; ++i) {
    tampered.entries[i].entry["op"] = testing::renameOp("ghost", "never applied");
  }
  LoadedDocument fromSnapshot = loaded(tampered, false);
  ASSERT_NE(fromSnapshot.doc, nullptr);
  EXPECT_TRUE(sameDocumentData(*fromSnapshot.doc, *live->doc));

  // Verify replays the whole log from the base and agrees.
  LoadedDocument verified = loaded(stored, true);
  ASSERT_NE(verified.doc, nullptr);
  EXPECT_TRUE(sameDocumentData(*verified.doc, *live->doc));

  ops::OperationLog log(std::move(opened.entries));
  ops::OperationDispatcher dispatcher(*opened.doc, live->handlers, log, [] { return 0.0; });
  ops::UndoManager undo(dispatcher, log);
  EXPECT_EQ(undo.stacks(), live->undo.stacks());
  ASSERT_TRUE(undo.undo().has_value());
  ASSERT_TRUE(live->undo.undo().has_value());
  EXPECT_EQ(log.entries().back().kind, ops::EntryKind::Undo);
  EXPECT_EQ(log.entries().back().target, 250);
  EXPECT_TRUE(sameDocumentData(*opened.doc, *live->doc));
  EXPECT_NE(opened.doc->feature(renamed)->name, "last");
}

TEST(LoadDocument, SnapshotPlusTheRestOfTheLogEqualsReplayFromTheBase) {
  auto s = aStoredSession(7, 5);
  LoadedDocument opened = loaded(s.stored, true);
  ASSERT_NE(opened.doc, nullptr);
  EXPECT_TRUE(sameDocumentData(*opened.doc, *s.session->doc));
  EXPECT_EQ(opened.doc->feature(FeatureId("a"))->name, "A7");
}

TEST(LoadDocument, ASnapshotTheReplayFromTheBaseDoesNotReproduceIsASnapshotErrorAtDocument) {
  auto s = aStoredSession(3);
  // A snapshot at 3 that does not match the log: the state after a different history.
  dispatch(*s.session, testing::renameOp("a", "elsewhere"));
  s.stored.snapshot = snapshotJson(*s.session->doc, 3);
  const LoadError error = loadError(s.stored, true);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"document"});
  // Without verify the mismatch goes unnoticed.
  EXPECT_EQ(loaded(s.stored, false).doc->feature(FeatureId("a"))->name, "elsewhere");
}

TEST(LoadDocument, LoadsADocumentWithoutEntriesFromItsBaseSnapshot) {
  auto s = aStoredSession(0);
  LoadedDocument opened = loaded(s.stored);
  EXPECT_TRUE(sameDocumentData(*opened.doc, *s.session->doc));
  EXPECT_TRUE(opened.entries.empty());
}

TEST(LoadDocument, RestoresTheWholeLogNotOnlyTheEntriesAfterTheSnapshot) {
  auto s = aStoredSession(4, 4);
  EXPECT_EQ(jsonOf(loaded(s.stored).entries), jsonOf(s.session->log.entries()));
}

TEST(LoadDocument, KeepsBodyNamesAndHidingFromTheSnapshotAndFromTheLog) {
  auto session = aSession();
  const Json base = snapshotJson(*session->doc, 0);
  const std::vector<Json> ops = {
      {{"type", "body.rename"}, {"v", 1}, {"body", "a/body"}, {"name", "Base"}},
      {{"type", "body.setVisible"}, {"v", 1}, {"body", "a/body"}, {"visible", false}},
      {{"type", "body.setVisible"}, {"v", 1}, {"body", "a/body:1"}, {"visible", false}},
      {{"type", "body.rename"}, {"v", 1}, {"body", "a/body:1"}, {"name", "Other"}},
  };
  auto partial = aSession();
  for (std::size_t i = 0; i < ops.size(); ++i) {
    dispatch(*session, ops[i]);
    if (i < 2) dispatch(*partial, ops[i]);
  }
  // All metadata in the snapshot at 4, or half of it at 2 and entries 3 and 4 replayed on top.
  const StoredDocument full = storedOf(base, session->log, snapshotJson(*session->doc, 4));
  const StoredDocument half = storedOf(base, session->log, snapshotJson(*partial->doc, 2));
  for (const StoredDocument* stored : {&full, &half}) {
    for (const bool verify : {true, false}) {
      LoadedDocument opened = loaded(*stored, verify);
      ASSERT_NE(opened.doc, nullptr);
      EXPECT_EQ(opened.doc->bodyMeta(document::BodyId("a/body")),
                (document::BodyMeta{.name = "Base", .hidden = true}));
      EXPECT_EQ(opened.doc->bodyMeta(document::BodyId("a/body:1")),
                (document::BodyMeta{.name = "Other", .hidden = true}));
      EXPECT_TRUE(sameDocumentData(*opened.doc, *session->doc));
    }
  }
}

// --- migration of feature data (Q035) -----------------------------------------------------

/** The box schema before and after a change: version 2 renamed `w` to `width`. */
std::shared_ptr<testing::TestSchema> boxV1() { return std::make_shared<testing::TestSchema>("box", 1); }

std::shared_ptr<testing::TestSchema> boxV2() {
  return std::make_shared<testing::TestSchema>(
      "box", 2, document::ParamSchema{},
      [](int fromVersion, const Json& raw) -> core::Result<Json, std::string> {
        if (fromVersion != 1) return core::fail(std::string("Unsupported version"));
        if (!raw.contains("w") || !raw.at("w").is_number()) {
          return core::fail(std::string("w must be a number"));
        }
        return Json{{"width", raw.at("w")}};
      });
}

Json setW(double w, const std::string& featureId = "a") {
  return testing::setParamsOp(featureId, {{"w", w}});
}

/** An operation as written before M10.1: feature.setParams version 1 without typeVersion. */
Json writtenBeforeM101(Json op) {
  if (op.at("type") == "batch") {
    for (Json& inner : op.at("ops")) inner = writtenBeforeM101(inner);
    return op;
  }
  if (op.at("type") != "feature.setParams") return op;
  op.erase("typeVersion");
  op["v"] = 1;
  return op;
}

/**
 * Saved before M10.1 while box had version 1: base with 'a', then add 'b', two setParams of 'a'
 * and an undo of the second, setParams in operation version 1; a snapshot at 3.
 */
StoredDocument aVersion1Document() {
  document::FeatureSchemaRegistry v1;
  v1.add(boxV1());
  OpsSession s(
      {.id = "d1", .name = "Doc", .features = {testing::aFeature({.id = "a", .name = "A", .params = Json{{"w", 1}}})}},
      v1);
  const Json base = snapshotJson(*s.doc, 0);
  dispatch(s, testing::addOp(*testing::aFeature({.id = "b", .name = "B", .params = Json{{"w", 2}}}), 1));
  dispatch(s, setW(5));
  dispatch(s, setW(7));
  const Json snapshot = snapshotJson(*s.doc, 3);
  EXPECT_TRUE(s.undo.undo().has_value());
  StoredDocument stored = storedOf(base, s.log, snapshot);
  for (StoredEntry& entry : stored.entries) {
    entry.entry["op"] = writtenBeforeM101(entry.entry["op"]);
    entry.entry["inverse"] = writtenBeforeM101(entry.entry["inverse"]);
  }
  return stored;
}

TEST(LoadDocumentMigration, ADocumentSavedWithVersion1LoadsWithVersion2EveryFeatureMigrated) {
  const StoredDocument stored = aVersion1Document();
  EXPECT_EQ(stored.entries[1].entry["op"],
            (Json{{"type", "feature.setParams"}, {"v", 1}, {"featureId", "a"}, {"params", {{"w", 5}}}}));
  document::FeatureSchemaRegistry v2;
  v2.add(boxV2());
  LoadedDocument opened = loaded(stored, true, v2);
  ASSERT_NE(opened.doc, nullptr);
  const auto studio = opened.doc->studio();
  ASSERT_EQ(studio->features.size(), 2U);
  EXPECT_EQ(studio->features[0]->typeVersion, 2);
  EXPECT_EQ(*studio->features[0]->params, (Json{{"width", 5}}));
  EXPECT_EQ(studio->features[1]->typeVersion, 2);
  EXPECT_EQ(*studio->features[1]->params, (Json{{"width", 2}}));
}

TEST(LoadDocumentMigration, UndoAndRedoAfterLoadingApplyTheOldEntriesInTheNewShape) {
  document::FeatureSchemaRegistry v2;
  v2.add(boxV2());
  LoadedDocument opened = loaded(aVersion1Document(), true, v2);
  ASSERT_NE(opened.doc, nullptr);
  const ops::OpHandlerRegistry handlers(v2);
  ops::OperationLog log(std::move(opened.entries));
  ops::OperationDispatcher dispatcher(*opened.doc, handlers, log, [] { return 0.0; });
  ops::UndoManager undo(dispatcher, log);

  // Undo of setW(5): its inverse was recorded with version 1 params { w: 1 }.
  ASSERT_TRUE(undo.undo().has_value());
  EXPECT_EQ(opened.doc->feature(FeatureId("a"))->typeVersion, 2);
  EXPECT_EQ(*opened.doc->feature(FeatureId("a"))->params, (Json{{"width", 1}}));
  // The new entry is computed from the migrated document: current version already.
  EXPECT_EQ(log.entries().back().inverse.at("typeVersion"), 2);
  EXPECT_EQ(log.entries().back().inverse.at("params"), (Json{{"width", 5}}));

  ASSERT_TRUE(undo.redo().has_value());
  EXPECT_EQ(*opened.doc->feature(FeatureId("a"))->params, (Json{{"width", 5}}));
}

TEST(LoadDocumentMigration, AnEntryWhoseMigrationFailsIsAnEntryError) {
  StoredDocument stored = aVersion1Document();
  Json bad = setW(1);
  bad["params"] = {{"w", "x"}};
  Json entry = testing::anEntryJson(5, bad);
  entry["inverse"] = setW(5);
  stored.entries.push_back(StoredEntry{5, std::nullopt, entry});
  document::FeatureSchemaRegistry v2;
  v2.add(boxV2());
  const ops::OpHandlerRegistry handlers(v2);
  auto result = loadDocument(stored, id, v2, handlers, false);
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().kind, LoadError::Kind::Entry);
  EXPECT_EQ(result.error().seq, 5);
  EXPECT_EQ(pathsOf(result.error()), std::vector<std::string>{"op"});
  EXPECT_NE(result.error().issues[0].message.find("w must be a number"), std::string::npos);
}

// --- errors -------------------------------------------------------------------------------

TEST(LoadDocumentErrors, AnEntryThatDoesNotParseIsAnEntryErrorWithItsSeqAndPath) {
  auto s = aStoredSession(3);
  s.stored.entries[2].entry["op"]["name"] = 42;
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 3);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"op.name"});
}

TEST(LoadDocumentErrors, AGapInSeqIsAnEntryErrorAtThePositionOfTheGap) {
  auto s = aStoredSession(3);
  s.stored.entries.erase(s.stored.entries.begin() + 1);
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 2);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"seq"});
}

TEST(LoadDocumentErrors, AnEntryTheHandlerRejectsDuringReplayIsAnEntryErrorAtOp) {
  auto s = aStoredSession(4);
  s.stored.entries[3].entry["op"] = testing::renameOp("missing", "ghost");
  const LoadError error = loadError(s.stored, false);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 4);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"op"});
}

TEST(LoadDocumentErrors, WithVerifyAnEntryBeforeTheSnapshotThatTheHandlerRejectsIsAnEntryError) {
  auto s = aStoredSession(4, 4);
  // Entry 3 is covered by the snapshot: only the replay from the base applies it.
  s.stored.entries[2].entry["op"] = testing::renameOp("missing", "ghost");
  EXPECT_EQ(loaded(s.stored, false).doc->feature(FeatureId("a"))->name, "A4");
  const LoadError error = loadError(s.stored, true);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 3);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"op"});
}

TEST(LoadDocumentErrors, ASnapshotWithAWrongFormatIsASnapshotError) {
  auto s = aStoredSession(2, 2);
  s.stored.snapshot["format"] = "nope";
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"format"});
}

TEST(LoadDocumentErrors, ASnapshotOfANewerFormatVersionSaysSo) {
  auto s = aStoredSession(2, 2);
  s.stored.snapshot["formatVersion"] = 2;
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"formatVersion"});
  EXPECT_NE(error.issues[0].message.find("newer"), std::string::npos);
}

TEST(LoadDocumentErrors, EnvelopeIssuesComeInOrderFormatFormatVersionAtSeq) {
  auto s = aStoredSession(2, 2);
  s.stored.snapshot["format"] = 1;
  s.stored.snapshot["formatVersion"] = "1";
  s.stored.snapshot["atSeq"] = 1.5;
  EXPECT_EQ(pathsOf(loadError(s.stored)), (std::vector<std::string>{"format", "formatVersion", "atSeq"}));
}

TEST(LoadDocumentErrors, ASnapshotBeyondTheStoredEntriesIsASnapshotErrorAtAtSeq) {
  auto s = aStoredSession(2, 2);
  s.stored.entries.pop_back();
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"atSeq"});
}

TEST(LoadDocumentErrors, ASnapshotOfAnotherDocumentIsASnapshotErrorAtDocumentMetaId) {
  auto s = aStoredSession(1);
  s.stored.snapshot = snapshotJson(*testing::aDocument({.id = "other"}), 1);
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"document.meta.id"});
}

TEST(LoadDocumentErrors, BrokenDocumentDataInTheSnapshotReportsFromDataIssuesUnderDocument) {
  auto s = aStoredSession(2, 2);
  s.stored.snapshot["document"]["studio"] = {{"features", "no"}};
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Snapshot);
  ASSERT_FALSE(error.issues.empty());
  EXPECT_EQ(error.issues[0].path, "document.studio.features");
}

TEST(LoadDocumentErrors, ABrokenBaseIsReportedAsBaseOnlyWithVerify) {
  auto s = aStoredSession(1, 1);
  s.stored.base["document"]["studio"] = {{"features", "no"}};
  EXPECT_EQ(loaded(s.stored, false).doc->feature(FeatureId("a"))->name, "A1");
  const LoadError error = loadError(s.stored, true);
  EXPECT_EQ(error.kind, LoadError::Kind::Base);
  ASSERT_FALSE(error.issues.empty());
  EXPECT_EQ(error.issues[0].path, "document.studio.features");
}

TEST(LoadDocumentErrors, ABaseWithAtSeqOtherThan0IsABaseErrorAtAtSeq) {
  auto s = aStoredSession(1, 1);
  s.stored.base["atSeq"] = 1;
  const LoadError error = loadError(s.stored, true);
  EXPECT_EQ(error.kind, LoadError::Kind::Base);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"atSeq"});
}

/** A handler with a bug: its apply asserts. */
class AssertingHandler final : public ops::OpHandler {
 public:
  [[nodiscard]] std::string_view type() const override { return "test.assert"; }
  [[nodiscard]] int version() const override { return 1; }
  [[nodiscard]] core::Result<ops::Operation, ops::OperationLoadError> invert(
      const document::DocumentReader& /*doc*/, const ops::Operation& op) const override {
    return op;
  }
  core::Result<void, ops::OperationLoadError> apply(document::DocumentWriter& /*doc*/,
                                                    const ops::Operation& /*op*/) const override {
    TINYCAD_ASSERT(false, "test.assert: a bug");
    return {};
  }
};

TEST(LoadDocumentErrors, AnExceptionWhileReplayingIsABugAndPropagates) {
  auto s = aStoredSession(1);
  const Json op = {{"type", "test.assert"}, {"v", 1}};
  s.stored.entries[0].entry["op"] = op;
  s.stored.entries[0].entry["inverse"] = op;
  ops::OpHandlerRegistry handlers(testing::noSchemas());
  handlers.add(std::make_shared<AssertingHandler>());
  EXPECT_THROW((void)loadDocument(s.stored, id, testing::noSchemas(), handlers, false),
               core::AssertionError);
}

TEST(LoadDocumentErrors, AnUndoEntryOffTheTopOfTheStackIsAnEntryErrorAtTarget) {
  auto s = aStoredSession(2);
  ASSERT_TRUE(s.session->undo.undo().has_value());
  s.stored = storedOf(s.stored.base, s.session->log, s.stored.base);
  // Entry 3 undoes entry 2; pointed at entry 1 it is not the top of the undo stack (N104).
  ASSERT_EQ(s.stored.entries[2].entry["target"], 2);
  s.stored.entries[2].entry["target"] = 1;
  for (const bool verify : {false, true}) {
    const LoadError error = loadError(s.stored, verify);
    EXPECT_EQ(error.kind, LoadError::Kind::Entry);
    EXPECT_EQ(error.seq, 3);
    EXPECT_EQ(pathsOf(error), std::vector<std::string>{"target"});
  }
}

TEST(LoadDocumentErrors, ARedoEntryWithAnEmptyRedoStackIsAnEntryErrorAtTarget) {
  auto s = aStoredSession(2);
  ASSERT_TRUE(s.session->undo.undo().has_value());
  s.stored = storedOf(s.stored.base, s.session->log, s.stored.base);
  s.stored.entries[2].entry["kind"] = "redo";
  const LoadError error = loadError(s.stored);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 3);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"target"});
}

TEST(LoadDocumentErrors, EveryEntryIsParsedAlsoTheOnesBeforeTheSnapshot) {
  auto s = aStoredSession(3, 3);
  s.stored.entries[1].entry["label"] = 7;
  const LoadError error = loadError(s.stored, false);
  EXPECT_EQ(error.kind, LoadError::Kind::Entry);
  EXPECT_EQ(error.seq, 2);
  EXPECT_EQ(pathsOf(error), std::vector<std::string>{"label"});
}

}  // namespace
}  // namespace tinycad::storage
