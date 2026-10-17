// RuntimeDocument (spec 14 "Sezení", "Změny dokumentu", "Idempotence", "Vlákna a zámky serveru";
// decisions N47, N54, N55, N58, N107, N155): the edit lease, the steps of a change, durable and
// in-memory idempotence, STORAGE (reverted, the reload only as the fallback), rename through the
// document and the events.

#include "tinycad/session/runtime_document.hpp"

#include <gtest/gtest.h>

#include "ops/testing.hpp"
#include "session/runtime_testing.hpp"
#include "tinycad/document/serialize.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class RuntimeDocumentTest : public RuntimeFixture {
 protected:
  document::DocumentId id = createDocument("Part");
  std::unique_ptr<RuntimeDocument> doc = openRuntime(id);
  Caller writer = callerOf("s1");
  Caller reader = callerOf("s2");
  RecentResponses writerRecent;
  ReadModelOptions options;
  ChangeResult out;

  void SetUp() override { ASSERT_TRUE(doc->acquireLease(writer.session)); }

  StepKey step(const std::string& operationId, const std::string& fingerprint = "fp") {
    return {writerRecent, key(operationId, fingerprint)};
  }

  /** dispatch by the writer; fails the test on an error. */
  void dispatch(const Json& op, const std::string& operationId) {
    ASSERT_TRUE(keep(doc->dispatch(writer, op, "", key(operationId), options)));
  }

  /** A successful change is kept in `out`; false (with the message) for an error. */
  ::testing::AssertionResult keep(SessionResult<ChangeResult> result) {
    if (!result) return ::testing::AssertionFailure() << result.error().message;
    out = std::move(*result);
    return ::testing::AssertionSuccess();
  }

  template <class T>
  static ErrorReason reasonOf(const SessionResult<T>& result) {
    EXPECT_FALSE(result.has_value());
    return result ? ErrorReason::Internal : result.error().reason;
  }
};

TEST_F(RuntimeDocumentTest, OpeningAMissingDocumentIsDocumentNotFound) {
  auto missing = RuntimeDocument::open(document::DocumentId("nope"), deps);
  ASSERT_FALSE(missing.has_value());
  EXPECT_EQ(missing.error().reason, ErrorReason::DocumentNotFound);
}

TEST_F(RuntimeDocumentTest, OpensWithItsIdNoEventsAndTheLeaseFree) {
  auto other = openRuntime(id);
  EXPECT_EQ(other->id(), id);
  EXPECT_EQ(other->events().lastSeq(), 0U);
  EXPECT_FALSE(other->leaseHolder().has_value());
}

// --- the edit lease (Q102) ----------------------------------------------------------------

TEST_F(RuntimeDocumentTest, TheFirstSessionGetsTheLeaseAndKeepsIt) {
  EXPECT_EQ(doc->leaseHolder(), writer.session);
  EXPECT_TRUE(doc->acquireLease(writer.session));
  EXPECT_FALSE(doc->acquireLease(reader.session));
  EXPECT_EQ(doc->leaseHolder(), writer.session);
}

TEST_F(RuntimeDocumentTest, ReleasingTheLeaseByAnotherSessionDoesNothing) {
  doc->releaseLease(reader.session);
  EXPECT_EQ(doc->leaseHolder(), writer.session);
  doc->releaseLease(writer.session);
  EXPECT_FALSE(doc->leaseHolder().has_value());
  EXPECT_TRUE(doc->acquireLease(reader.session));
}

TEST_F(RuntimeDocumentTest, EveryChangeOfASessionWithoutTheLeaseIsReadOnly) {
  RecentResponses recent;
  const StepKey readerStep{recent, key("r1")};
  EXPECT_EQ(reasonOf(doc->dispatch(reader, addBox("a", 0), "", key("r1"), options)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->begin(reader, "T", readerStep, options)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->apply(reader, addBox("a", 0), readerStep, options)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->applyTransient(reader, setRollback(0), readerStep, options)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->commit(reader, readerStep, options)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->abort(reader, readerStep, options)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->undo(reader, key("r1"), options)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->redo(reader, key("r1"), options)), ErrorReason::ReadOnly);
  EXPECT_TRUE(storedLog(id).empty());
  EXPECT_TRUE(changedOf(*doc).empty());
  EXPECT_EQ(recent.size(), 0U);
}

TEST_F(RuntimeDocumentTest, TheReadModelSaysWhetherTheCallerMayWrite) {
  auto model = doc->readModel(writer, options);
  ASSERT_TRUE(model.has_value());
  EXPECT_TRUE(model->session.writable);
  model = doc->readModel(reader, options);
  ASSERT_TRUE(model.has_value());
  EXPECT_FALSE(model->session.writable);
  EXPECT_EQ(model->meta.id, id);
  EXPECT_EQ(model->meta.name, "Part");
}

TEST_F(RuntimeDocumentTest, ReleasingTheLeaseWithAnOpenTransactionAbortsIt) {
  ASSERT_TRUE(keep(doc->begin(writer, "T", step("b1"), options)));
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a1"), options)));
  const auto changesBefore = changedOf(*doc).size();

  doc->releaseLease(writer.session);
  EXPECT_FALSE(doc->leaseHolder().has_value());
  const auto changes = changedOf(*doc);
  ASSERT_EQ(changes.size(), changesBefore + 1);
  EXPECT_EQ(changes.back().bySessionId, "s1");

  ASSERT_TRUE(doc->acquireLease(reader.session));
  auto model = doc->readModel(reader, options);
  ASSERT_TRUE(model.has_value());
  EXPECT_FALSE(model->session.transactionLabel.has_value());
  RecentResponses recent;
  EXPECT_EQ(reasonOf(doc->commit(reader, StepKey{recent, key("c1")}, options)),
            ErrorReason::NoTransaction);
  EXPECT_TRUE(storedLog(id).empty());
}

// --- a change: entry, generation, event, read model ---------------------------------------

TEST_F(RuntimeDocumentTest, DispatchWritesTheEntryAndAnswersWithItAndTheReadModel) {
  dispatch(addBox("a", 0), "op-1");
  ASSERT_TRUE(out.entry.has_value());
  EXPECT_EQ(out.entry->at("seq"), 1U);
  EXPECT_EQ(out.entry->at("kind"), "do");
  EXPECT_EQ(out.entry->at("op").at("type"), "feature.add");
  EXPECT_EQ(out.readModel.lastSeq, 1);
  EXPECT_EQ(out.readModel.generation, 1U);
  EXPECT_TRUE(out.readModel.session.writable);
  EXPECT_TRUE(out.readModel.session.canUndo);
  EXPECT_EQ(storedLog(id).size(), 1U);

  const auto changes = changedOf(*doc);
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].generation, 1U);
  EXPECT_EQ(changes[0].lastSeq, 1);
  EXPECT_EQ(changes[0].bySessionId, "s1");
}

TEST_F(RuntimeDocumentTest, AnInvalidOperationChangesNothing) {
  dispatch(addBox("a", 0), "op-1");
  const auto seqBefore = doc->events().lastSeq();
  auto invalid = doc->dispatch(writer, setWidth("zzz", 5), "", key("op-2"), options);
  ASSERT_FALSE(invalid.has_value());
  EXPECT_EQ(invalid.error().reason, ErrorReason::InvalidOperation);
  EXPECT_FALSE(invalid.error().path.empty());
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, TheRegenerationReportsProgressWithTheGenerationOfTheChange) {
  dispatch(addBox("a", 0), "op-1");
  std::vector<SessionEvent> progress;
  for (const auto& event : eventsOf(*doc)) {
    if (event.kind == SessionEvent::Kind::RegenProgress) progress.push_back(event);
  }
  ASSERT_FALSE(progress.empty());
  EXPECT_EQ(progress.back().featureId.str(), "a");
  EXPECT_EQ(progress.back().generation, 1U);
  EXPECT_EQ(progress.back().status.kind, regen::FeatureStatusKind::Ok);
}

/** The feature ids of the regen_progress events with seq > afterSeq, in order. */
std::vector<std::string> progressAfter(RuntimeDocument& doc, std::uint64_t afterSeq) {
  std::vector<std::string> ids;
  for (const auto& event : doc.events().after(afterSeq).value_or(std::vector<SessionEvent>{})) {
    if (event.kind == SessionEvent::Kind::RegenProgress) ids.push_back(event.featureId.str());
  }
  return ids;
}

TEST_F(RuntimeDocumentTest, ProgressReportsOnlyTheFeaturesTheChangeRebuilt) {
  dispatch(addBox("a", 0), "op-1");
  dispatch(addBox("b", 1), "op-2");
  const auto seq = doc->events().lastSeq();
  dispatch(addBox("c", 2), "op-3");
  // 'a' and 'b' come from the cache of the Regenerator: no progress for them (N118).
  EXPECT_EQ(progressAfter(*doc, seq), std::vector<std::string>{"c"});

  const auto beforeEdit = doc->events().lastSeq();
  dispatch(setWidth("b", 20), "op-4");
  EXPECT_EQ(progressAfter(*doc, beforeEdit), (std::vector<std::string>{"b", "c"}));
}

TEST_F(RuntimeDocumentTest, AReadModelWithoutAChangeReportsNoProgress) {
  dispatch(addBox("a", 0), "op-1");
  const auto seq = doc->events().lastSeq();
  ASSERT_TRUE(doc->readModel(writer, options));
  ASSERT_TRUE(doc->readModel(reader, options));
  dispatch(addBox("a", 0), "op-1");  // a repeated request is no change either
  EXPECT_EQ(doc->events().lastSeq(), seq);
}

TEST_F(RuntimeDocumentTest, MovingTheRollbackBarBackRebuildsNothing) {
  dispatch(addBox("a", 0), "op-1");
  dispatch(addBox("b", 1), "op-2");
  const auto seq = doc->events().lastSeq();
  dispatch(setRollback(1), "op-3");
  EXPECT_TRUE(progressAfter(*doc, seq).empty());
  const auto back = doc->events().lastSeq();
  dispatch(setRollback(2), "op-4");
  // 'b' stayed in the cache behind the bar: moving the bar forward takes it from there.
  EXPECT_TRUE(progressAfter(*doc, back).empty());
}

TEST_F(RuntimeDocumentTest, TheEventSeqOfAReadModelIsTheLastSeqAtTheSameMoment) {
  dispatch(addBox("a", 0), "op-1");
  std::uint64_t eventSeq = 0;
  ASSERT_TRUE(doc->readModel(reader, options, &eventSeq));
  EXPECT_EQ(eventSeq, doc->events().lastSeq());
  EXPECT_GT(eventSeq, 0U);
}

// --- durable idempotence (N34, N107) ------------------------------------------------------

TEST_F(RuntimeDocumentTest, DispatchTwiceWithTheSameKeyIsOneEntryAndOneChange) {
  dispatch(addBox("a", 0), "op-1");
  const Json first = *out.entry;
  const auto seqAfterFirst = changedOf(*doc).size();

  // Not applied again: a second feature.add of 'a' would fail with a duplicate id.
  dispatch(addBox("a", 0), "op-1");
  EXPECT_EQ(*out.entry, first);
  EXPECT_EQ(storedLog(id).size(), 1U);
  EXPECT_EQ(changedOf(*doc).size(), seqAfterFirst);
}

TEST_F(RuntimeDocumentTest, TheSameIdWithAnotherFingerprintIsOperationIdReused) {
  dispatch(addBox("a", 0), "op-1");
  const auto seqBefore = doc->events().lastSeq();
  auto reused = doc->dispatch(writer, addBox("b", 1), "", key("op-1", "other"), options);
  EXPECT_EQ(reasonOf(reused), ErrorReason::OperationIdReused);
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, CommitTwiceWithTheSameKeyIsOneEntry) {
  ASSERT_TRUE(keep(doc->begin(writer, "Box", step("b1"), options)));
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a1"), options)));
  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  const Json first = *out.entry;
  const auto changes = changedOf(*doc).size();

  // The transaction is gone; the repeat still finds the stored entry.
  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  EXPECT_EQ(*out.entry, first);
  EXPECT_EQ(storedLog(id).size(), 1U);
  EXPECT_EQ(changedOf(*doc).size(), changes);
}

TEST_F(RuntimeDocumentTest, AnEmptyCommitIsRememberedByTheSession) {
  ASSERT_TRUE(keep(doc->begin(writer, "Nothing", step("b1"), options)));
  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  EXPECT_FALSE(out.entry.has_value());
  const auto changes = changedOf(*doc).size();

  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  EXPECT_FALSE(out.entry.has_value());
  EXPECT_EQ(changedOf(*doc).size(), changes);
  EXPECT_EQ(reasonOf(doc->commit(writer, step("c2"), options)), ErrorReason::NoTransaction);
  EXPECT_TRUE(storedLog(id).empty());
}

// --- in-memory idempotence of transaction steps (N58) -------------------------------------

TEST_F(RuntimeDocumentTest, ApplyTwiceWithTheSameKeyIsAppliedOnce) {
  ASSERT_TRUE(keep(doc->begin(writer, "Box", step("b1"), options)));
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a1"), options)));
  const auto changes = changedOf(*doc).size();
  // A second feature.add of 'a' would fail: the repeat is answered without applying it.
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a1"), options)));
  EXPECT_FALSE(out.entry.has_value());
  EXPECT_EQ(changedOf(*doc).size(), changes);

  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 1U);
  EXPECT_EQ(log[0].at("op"), addBox("a", 0));
}

TEST_F(RuntimeDocumentTest, BeginAndAbortTwiceWithTheSameKeyAreOneStepEach) {
  ASSERT_TRUE(keep(doc->begin(writer, "T", step("b1"), options)));
  ASSERT_TRUE(keep(doc->begin(writer, "T", step("b1"), options)));
  ASSERT_TRUE(keep(doc->abort(writer, step("x1"), options)));
  ASSERT_TRUE(keep(doc->abort(writer, step("x1"), options)));
  EXPECT_EQ(changedOf(*doc).size(), 2U);
}

TEST_F(RuntimeDocumentTest, AStepIdWithAnotherOperationIsOperationIdReused) {
  ASSERT_TRUE(keep(doc->begin(writer, "Box", step("b1"), options)));
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a1", "fp-a"), options)));
  EXPECT_EQ(reasonOf(doc->apply(writer, addBox("b", 1), step("a1", "fp-b"), options)),
            ErrorReason::OperationIdReused);
}

TEST_F(RuntimeDocumentTest, AFailedStepIsNotRememberedAndRunsAgainOnRetry) {
  ASSERT_TRUE(keep(doc->begin(writer, "T", step("b1"), options)));
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("a", 5), step("a1"), options)),
            ErrorReason::InvalidOperation);
  // The document moved on (now 'a' exists): the retry of the failed step succeeds.
  ASSERT_TRUE(keep(doc->apply(writer, addBox("a", 0), step("a0"), options)));
  auto retry = doc->apply(writer, setWidth("a", 5), step("a1"), options);
  EXPECT_TRUE(retry.has_value());
}

// --- STORAGE (N155) -----------------------------------------------------------------------

/** The features and the rollback bar of a read model as JSON (for before/after comparisons). */
Json studioOf(const ReadModel& model) {
  Json features = Json::array();
  for (const auto& feature : model.studio->features) features.push_back(document::featureJson(*feature));
  return {{"features", features}, {"rollbackIndex", model.studio->rollbackIndex}};
}

TEST_F(RuntimeDocumentTest, AFailedDispatchIsRevertedWithoutAChange) {
  dispatch(addBox("a", 0), "op-1");
  const auto before = doc->readModel(writer, options);
  ASSERT_TRUE(before.has_value());
  const auto eventsBefore = eventsOf(*doc).size();

  fail->append = true;
  EXPECT_EQ(reasonOf(doc->dispatch(writer, setWidth("a", 20), "", key("op-2"), options)),
            ErrorReason::Storage);
  fail->append = false;

  // The inverse brought the document back: no event, the same generation and read model.
  EXPECT_EQ(eventsOf(*doc).size(), eventsBefore);
  const auto after = doc->readModel(writer, options);
  ASSERT_TRUE(after.has_value());
  EXPECT_EQ(after->generation, before->generation);
  EXPECT_EQ(after->lastSeq, 1);
  EXPECT_EQ(studioOf(*after), studioOf(*before));
  EXPECT_TRUE(after->session.canUndo);
  EXPECT_EQ(storedLog(id).size(), 1U);

  // The next change continues from it.
  dispatch(setWidth("a", 30), "op-2");
  EXPECT_EQ(storedLog(id).size(), 2U);
  EXPECT_EQ(storedLog(id)[1].at("inverse"), setWidth("a", 10));
}

/** A runtime document whose handlers know test.brokenInverse (its inverse always fails). */
class RuntimeDocumentBrokenInverseTest : public RuntimeDocumentTest {
 protected:
  ops::OpHandlerRegistry brokenHandlers = [this] {
    ops::OpHandlerRegistry handlers(registries.schemas);
    handlers.add(std::make_shared<tinycad::testing::BrokenInverseHandler>());
    return handlers;
  }();
  RuntimeDocument::Dependencies brokenDeps = [this] {
    RuntimeDocument::Dependencies copy{deps.catalog,  deps.schemas,   brokenHandlers,
                                       deps.builders, deps.now,       deps.steady,
                                       deps.newKernel, deps.newSolver, deps.eventCapacity,
                                       deps.verify};
    return copy;
  }();
  std::unique_ptr<RuntimeDocument> broken = [this] {
    auto opened = RuntimeDocument::open(id, brokenDeps);
    EXPECT_TRUE(opened.has_value());
    return opened ? std::move(*opened) : nullptr;
  }();

  void SetUp() override { ASSERT_TRUE(broken->acquireLease(writer.session)); }
};

TEST_F(RuntimeDocumentBrokenInverseTest, OnlyTheFallbackReloadIsAChange) {
  ASSERT_TRUE(keep(broken->dispatch(writer, tinycad::testing::BrokenInverseHandler::op("Stored"),
                                    "", key("op-1"), options)));
  const auto generationBefore = changedOf(*broken).back().generation;

  fail->append = true;
  auto failed = broken->dispatch(writer, tinycad::testing::BrokenInverseHandler::op("Lost"), "",
                                 key("op-2"), options);
  fail->append = false;
  EXPECT_EQ(reasonOf(failed), ErrorReason::Storage);

  // Reloaded from the file: generation + 1 and `changed` without a session.
  const auto changes = changedOf(*broken);
  EXPECT_EQ(changes.back().generation, generationBefore + 1);
  EXPECT_EQ(changes.back().bySessionId, "");
  const auto model = broken->readModel(writer, options);
  ASSERT_TRUE(model.has_value());
  EXPECT_EQ(model->meta.name, "Stored");
  EXPECT_EQ(model->lastSeq, 1);
}

// --- rename through the document (N37) ----------------------------------------------------

TEST_F(RuntimeDocumentTest, RenameWritesTheEntryWithoutALeaseAndAnnouncesItToEveryone) {
  doc->releaseLease(writer.session);
  wallTime = 5000;
  auto renamed = doc->rename("  New name ", key("rename-1"));
  ASSERT_TRUE(renamed.has_value()) << renamed.error().message;
  EXPECT_EQ(renamed->id, id);
  EXPECT_EQ(renamed->name, "New name");
  EXPECT_EQ(renamed->updatedAt, 5000);

  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 1U);
  EXPECT_EQ(log[0].at("op").at("type"), "document.rename");
  EXPECT_EQ(stored(id)->document().meta().name, "New name");
  const auto changes = changedOf(*doc);
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].bySessionId, "");

  // Repeated: the same summary, no second entry.
  ASSERT_TRUE(doc->rename("  New name ", key("rename-1")));
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, RenameIsRefusedWhileATransactionIsOpenAndForAnEmptyName) {
  ASSERT_TRUE(keep(doc->begin(writer, "T", step("b1"), options)));
  auto open = doc->rename("Other", key("rename-1"));
  ASSERT_FALSE(open.has_value());
  EXPECT_EQ(open.error().reason, ErrorReason::DocumentOpen);
  ASSERT_TRUE(keep(doc->abort(writer, step("x1"), options)));

  auto empty = doc->rename(" \t", key("rename-2"));
  ASSERT_FALSE(empty.has_value());
  EXPECT_EQ(empty.error().reason, ErrorReason::InvalidOperation);
  EXPECT_EQ(empty.error().path, "name");
  EXPECT_TRUE(storedLog(id).empty());
}

// --- history and STEP ---------------------------------------------------------------------

TEST_F(RuntimeDocumentTest, HistoryListsTheEntriesAndTheUndoStacks) {
  dispatch(addBox("a", 0), "op-1");
  dispatch(addBox("b", 1), "op-2");
  ASSERT_TRUE(keep(doc->undo(writer, key("op-3"), options)));
  HistoryView history = doc->history(1);
  ASSERT_EQ(history.entries.size(), 3U);
  EXPECT_EQ(history.entries[2].at("kind"), "undo");
  EXPECT_EQ(history.entries[2].at("target"), 2);
  ASSERT_EQ(history.undoStack.size(), 1U);
  EXPECT_EQ(history.undoStack[0], 1);
  ASSERT_EQ(history.redoStack.size(), 1U);
  EXPECT_EQ(history.redoStack[0], 2);

  history = doc->history(3);
  EXPECT_EQ(history.entries.size(), 1U);
}

TEST_F(RuntimeDocumentTest, ExportStepWritesTheVisibleBodies) {
  dispatch(addBox("a", 0), "op-1");
  auto step = doc->exportStep();
  ASSERT_TRUE(step.has_value()) << step.error().message;
  EXPECT_TRUE(step->content.starts_with("ISO-10303-21;"));
  EXPECT_EQ(step->fileName, "Part.step");
}

// --- sketches are solved before the dispatcher (N47) --------------------------------------

Json sketchFeature(const std::string& id, Json entities, Json constraints) {
  return {{"id", id},
          {"type", "sketch"},
          {"typeVersion", 1},
          {"name", id},
          {"params",
           {{"plane", Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}})},
            {"entities", std::move(entities)},
            {"constraints", std::move(constraints)}}},
          {"suppressed", false}};
}

Json circleSketch(const std::string& id, double drawnRadius) {
  return sketchFeature(
      id,
      Json::array({{{"kind", "point"}, {"id", "c"}, {"x", 3}, {"y", 4}},
                   {{"kind", "circle"}, {"id", "C"}, {"center", "c"}, {"radius", drawnRadius}}}),
      Json::array({{{"kind", "fix"}, {"id", "f"}, {"point", "c"}},
                   {{"kind", "radius"}, {"id", "r"}, {"curve", "C"}, {"value", 2.5}}}));
}

/** Two fixed points 10 apart and a distance of 12 between them: planegcs reports a conflict. */
Json conflictingSketchParams() {
  return {{"plane", Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}})},
          {"entities",
           Json::array({{{"kind", "point"}, {"id", "a"}, {"x", 0}, {"y", 0}},
                        {{"kind", "point"}, {"id", "b"}, {"x", 10}, {"y", 0}}})},
          {"constraints",
           Json::array({{{"kind", "fix"}, {"id", "fa"}, {"point", "a"}},
                        {{"kind", "fix"}, {"id", "fb"}, {"point", "b"}},
                        {{"kind", "distance"},
                         {"id", "W"},
                         {"a", "a"},
                         {"b", "b"},
                         {"value", 12}}})}};
}

TEST_F(RuntimeDocumentTest, ASolvedSketchIsStoredWithTheServerCoordinates) {
  if (!registries.knows("sketch")) GTEST_SKIP() << "the sketch schema comes with M44.1";
  const Json add{
      {"type", "feature.add"}, {"v", 1}, {"feature", circleSketch("s", 1.7)}, {"index", 0}};
  dispatch(add, "op-1");
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 1U);
  const Json& entities = log[0].at("op").at("feature").at("params").at("entities");
  EXPECT_DOUBLE_EQ(entities.at(1).at("radius").get<double>(), 2.5);
}

TEST_F(RuntimeDocumentTest, ASketchTheServerCannotSolveIsRefusedAndChangesNothing) {
  if (!registries.knows("sketch")) GTEST_SKIP() << "the sketch schema comes with M44.1";
  const Json add{
      {"type", "feature.add"}, {"v", 1}, {"feature", circleSketch("s", 2.5)}, {"index", 0}};
  dispatch(add, "op-1");
  ASSERT_TRUE(keep(doc->begin(writer, "Edit sketch", step("b1"), options)));
  const auto seqBefore = doc->events().lastSeq();

  const Json edit{{"type", "feature.setParams"}, {"v", 2},         {"featureId", "s"},
                  {"typeVersion", 1},            {"params", conflictingSketchParams()}};
  auto refused = doc->apply(writer, edit, step("a1"), options);
  ASSERT_FALSE(refused.has_value());
  EXPECT_EQ(refused.error().reason, ErrorReason::SketchNotSolved);
  ASSERT_EQ(refused.error().issues.size(), 1U);
  EXPECT_EQ(refused.error().issues[0].code, "sketch.notSolved");
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);

  // The transaction is still open and empty: the commit writes nothing.
  ASSERT_TRUE(keep(doc->commit(writer, step("c1"), options)));
  EXPECT_FALSE(out.entry.has_value());
  EXPECT_EQ(storedLog(id).size(), 1U);
}

}  // namespace
}  // namespace tinycad::session
