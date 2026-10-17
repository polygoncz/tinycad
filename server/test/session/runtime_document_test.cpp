// RuntimeDocument (spec 14 "Sezení", "Změny dokumentu", "Idempotence", "Vlákna a zámky serveru";
// decisions N35, N47, N54, N55, N58, N107): the edit lease, the steps of a change, durable and
// in-memory idempotence, the STORAGE reload, rename through the document and the events.

#include "tinycad/session/runtime_document.hpp"

#include <gtest/gtest.h>

#include "session/runtime_testing.hpp"

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
  v1::ReadModelOptions options;
  v1::ChangeResult out;

  void SetUp() override { ASSERT_TRUE(doc->acquireLease(writer.session)); }

  StepKey step(const std::string& operationId, const std::string& fingerprint = "fp") {
    return {writerRecent, key(operationId, fingerprint)};
  }

  /** dispatch by the writer; fails the test on an error. */
  void dispatch(const Json& op, const std::string& operationId) {
    auto done = doc->dispatch(writer, op, "", key(operationId), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }

  static ErrorReason reasonOf(const SessionResult<void>& result) {
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
  EXPECT_EQ(reasonOf(doc->dispatch(reader, addBox("a", 0), "", key("r1"), options, &out)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->begin(reader, "T", readerStep, options, &out)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->apply(reader, addBox("a", 0), readerStep, options, &out)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->applyTransient(reader, setRollback(0), readerStep, options, &out)),
            ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->commit(reader, readerStep, options, &out)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->abort(reader, readerStep, options, &out)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->undo(reader, key("r1"), options, &out)), ErrorReason::ReadOnly);
  EXPECT_EQ(reasonOf(doc->redo(reader, key("r1"), options, &out)), ErrorReason::ReadOnly);
  EXPECT_TRUE(storedLog(id).empty());
  EXPECT_TRUE(changedOf(*doc).empty());
  EXPECT_EQ(recent.size(), 0U);
}

TEST_F(RuntimeDocumentTest, TheReadModelSaysWhetherTheCallerMayWrite) {
  v1::ReadModel model;
  ASSERT_TRUE(doc->readModel(writer, options, &model));
  EXPECT_TRUE(model.session().writable());
  ASSERT_TRUE(doc->readModel(reader, options, &model));
  EXPECT_FALSE(model.session().writable());
  EXPECT_EQ(model.document().document_id(), id.str());
  EXPECT_EQ(model.document().name(), "Part");
}

TEST_F(RuntimeDocumentTest, ReleasingTheLeaseWithAnOpenTransactionAbortsIt) {
  ASSERT_TRUE(doc->begin(writer, "T", step("b1"), options, &out));
  ASSERT_TRUE(doc->apply(writer, addBox("a", 0), step("a1"), options, &out));
  const auto changesBefore = changedOf(*doc).size();

  doc->releaseLease(writer.session);
  EXPECT_FALSE(doc->leaseHolder().has_value());
  const auto changes = changedOf(*doc);
  ASSERT_EQ(changes.size(), changesBefore + 1);
  EXPECT_EQ(changes.back().by_session_id(), "s1");

  ASSERT_TRUE(doc->acquireLease(reader.session));
  v1::ReadModel model;
  ASSERT_TRUE(doc->readModel(reader, options, &model));
  EXPECT_FALSE(model.session().has_transaction());
  RecentResponses recent;
  EXPECT_EQ(reasonOf(doc->commit(reader, StepKey{recent, key("c1")}, options, &out)),
            ErrorReason::NoTransaction);
  EXPECT_TRUE(storedLog(id).empty());
}

// --- a change: entry, generation, event, read model ---------------------------------------

TEST_F(RuntimeDocumentTest, DispatchWritesTheEntryAndAnswersWithItAndTheReadModel) {
  dispatch(addBox("a", 0), "op-1");
  ASSERT_TRUE(out.has_entry());
  EXPECT_EQ(out.entry().seq(), 1U);
  EXPECT_EQ(out.entry().kind(), v1::LogEntryView::KIND_DO);
  EXPECT_EQ(out.entry().op_type(), "feature.add");
  EXPECT_EQ(out.read_model().document().last_seq(), 1U);
  EXPECT_EQ(out.read_model().regen().generation(), 1U);
  EXPECT_TRUE(out.read_model().session().writable());
  EXPECT_TRUE(out.read_model().session().can_undo());
  EXPECT_EQ(storedLog(id).size(), 1U);

  const auto changes = changedOf(*doc);
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].generation(), 1U);
  EXPECT_EQ(changes[0].last_seq(), 1U);
  EXPECT_EQ(changes[0].by_session_id(), "s1");
}

TEST_F(RuntimeDocumentTest, AnInvalidOperationChangesNothing) {
  dispatch(addBox("a", 0), "op-1");
  const auto seqBefore = doc->events().lastSeq();
  auto invalid = doc->dispatch(writer, setWidth("zzz", 5), "", key("op-2"), options, &out);
  ASSERT_FALSE(invalid.has_value());
  EXPECT_EQ(invalid.error().reason, ErrorReason::InvalidOperation);
  EXPECT_FALSE(invalid.error().path.empty());
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, TheRegenerationReportsProgressWithTheGenerationOfTheChange) {
  dispatch(addBox("a", 0), "op-1");
  std::vector<v1::SessionEvent::RegenProgress> progress;
  for (const auto& event : eventsOf(*doc)) {
    if (event.has_regen_progress()) progress.push_back(event.regen_progress());
  }
  ASSERT_FALSE(progress.empty());
  EXPECT_EQ(progress.back().feature_id(), "a");
  EXPECT_EQ(progress.back().generation(), 1U);
  EXPECT_TRUE(progress.back().status().has_ok());
}

TEST_F(RuntimeDocumentTest, TheEventSeqOfAReadModelIsTheLastSeqAtTheSameMoment) {
  dispatch(addBox("a", 0), "op-1");
  v1::ReadModel model;
  std::uint64_t eventSeq = 0;
  ASSERT_TRUE(doc->readModel(reader, options, &model, &eventSeq));
  EXPECT_EQ(eventSeq, doc->events().lastSeq());
  EXPECT_GT(eventSeq, 0U);
}

// --- durable idempotence (N34, N107) ------------------------------------------------------

TEST_F(RuntimeDocumentTest, DispatchTwiceWithTheSameKeyIsOneEntryAndOneChange) {
  dispatch(addBox("a", 0), "op-1");
  const v1::LogEntryView first = out.entry();
  const auto seqAfterFirst = changedOf(*doc).size();

  // Not applied again: a second feature.add of 'a' would fail with a duplicate id.
  dispatch(addBox("a", 0), "op-1");
  EXPECT_EQ(out.entry().SerializeAsString(), first.SerializeAsString());
  EXPECT_EQ(storedLog(id).size(), 1U);
  EXPECT_EQ(changedOf(*doc).size(), seqAfterFirst);
}

TEST_F(RuntimeDocumentTest, TheSameIdWithAnotherFingerprintIsOperationIdReused) {
  dispatch(addBox("a", 0), "op-1");
  const auto seqBefore = doc->events().lastSeq();
  auto reused = doc->dispatch(writer, addBox("b", 1), "", key("op-1", "other"), options, &out);
  EXPECT_EQ(reasonOf(reused), ErrorReason::OperationIdReused);
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, CommitTwiceWithTheSameKeyIsOneEntry) {
  ASSERT_TRUE(doc->begin(writer, "Box", step("b1"), options, &out));
  ASSERT_TRUE(doc->apply(writer, addBox("a", 0), step("a1"), options, &out));
  ASSERT_TRUE(doc->commit(writer, step("c1"), options, &out));
  const v1::LogEntryView first = out.entry();
  const auto changes = changedOf(*doc).size();

  // The transaction is gone; the repeat still finds the stored entry.
  ASSERT_TRUE(doc->commit(writer, step("c1"), options, &out));
  EXPECT_EQ(out.entry().SerializeAsString(), first.SerializeAsString());
  EXPECT_EQ(storedLog(id).size(), 1U);
  EXPECT_EQ(changedOf(*doc).size(), changes);
}

TEST_F(RuntimeDocumentTest, AnEmptyCommitIsRememberedByTheSession) {
  ASSERT_TRUE(doc->begin(writer, "Nothing", step("b1"), options, &out));
  ASSERT_TRUE(doc->commit(writer, step("c1"), options, &out));
  EXPECT_FALSE(out.has_entry());
  const auto changes = changedOf(*doc).size();

  auto again = doc->commit(writer, step("c1"), options, &out);
  ASSERT_TRUE(again.has_value()) << again.error().message;
  EXPECT_FALSE(out.has_entry());
  EXPECT_EQ(changedOf(*doc).size(), changes);
  EXPECT_EQ(reasonOf(doc->commit(writer, step("c2"), options, &out)), ErrorReason::NoTransaction);
  EXPECT_TRUE(storedLog(id).empty());
}

// --- in-memory idempotence of transaction steps (N58) -------------------------------------

TEST_F(RuntimeDocumentTest, ApplyTwiceWithTheSameKeyIsAppliedOnce) {
  ASSERT_TRUE(doc->begin(writer, "Box", step("b1"), options, &out));
  ASSERT_TRUE(doc->apply(writer, addBox("a", 0), step("a1"), options, &out));
  const auto changes = changedOf(*doc).size();
  // A second feature.add of 'a' would fail: the repeat is answered without applying it.
  auto again = doc->apply(writer, addBox("a", 0), step("a1"), options, &out);
  ASSERT_TRUE(again.has_value()) << again.error().message;
  EXPECT_FALSE(out.has_entry());
  EXPECT_EQ(changedOf(*doc).size(), changes);

  ASSERT_TRUE(doc->commit(writer, step("c1"), options, &out));
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 1U);
  EXPECT_EQ(log[0].at("op"), addBox("a", 0));
}

TEST_F(RuntimeDocumentTest, BeginAndAbortTwiceWithTheSameKeyAreOneStepEach) {
  ASSERT_TRUE(doc->begin(writer, "T", step("b1"), options, &out));
  ASSERT_TRUE(doc->begin(writer, "T", step("b1"), options, &out));
  ASSERT_TRUE(doc->abort(writer, step("x1"), options, &out));
  ASSERT_TRUE(doc->abort(writer, step("x1"), options, &out));
  EXPECT_EQ(changedOf(*doc).size(), 2U);
}

TEST_F(RuntimeDocumentTest, AStepIdWithAnotherOperationIsOperationIdReused) {
  ASSERT_TRUE(doc->begin(writer, "Box", step("b1"), options, &out));
  ASSERT_TRUE(doc->apply(writer, addBox("a", 0), step("a1", "fp-a"), options, &out));
  EXPECT_EQ(reasonOf(doc->apply(writer, addBox("b", 1), step("a1", "fp-b"), options, &out)),
            ErrorReason::OperationIdReused);
}

TEST_F(RuntimeDocumentTest, AFailedStepIsNotRememberedAndRunsAgainOnRetry) {
  ASSERT_TRUE(doc->begin(writer, "T", step("b1"), options, &out));
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("a", 5), step("a1"), options, &out)),
            ErrorReason::InvalidOperation);
  // The document moved on (now 'a' exists): the retry of the failed step succeeds.
  ASSERT_TRUE(doc->apply(writer, addBox("a", 0), step("a0"), options, &out));
  auto retry = doc->apply(writer, setWidth("a", 5), step("a1"), options, &out);
  EXPECT_TRUE(retry.has_value());
}

// --- STORAGE (N35) ------------------------------------------------------------------------

TEST_F(RuntimeDocumentTest, AFailedWriteReloadsTheDocumentAndDropsTheTransaction) {
  dispatch(addBox("a", 0), "op-1");
  ASSERT_TRUE(doc->begin(writer, "Drag", step("b1"), options, &out));
  ASSERT_TRUE(doc->apply(writer, setWidth("a", 20), step("a1"), options, &out));
  const auto generationBefore = changedOf(*doc).back().generation();

  fail->append = true;
  EXPECT_EQ(reasonOf(doc->commit(writer, step("c1"), options, &out)), ErrorReason::Storage);
  fail->append = false;

  const auto changes = changedOf(*doc);
  EXPECT_EQ(changes.back().generation(), generationBefore + 1);
  EXPECT_EQ(changes.back().by_session_id(), "");
  EXPECT_EQ(storedLog(id).size(), 1U);
  EXPECT_EQ(storedParams(id, "a").at("width"), 10);

  // The transaction is gone with the reload: the retried Commit is NoTransaction.
  EXPECT_EQ(reasonOf(doc->commit(writer, step("c1"), options, &out)), ErrorReason::NoTransaction);
  v1::ReadModel model;
  ASSERT_TRUE(doc->readModel(writer, options, &model));
  EXPECT_FALSE(model.session().has_transaction());
  EXPECT_EQ(model.document().last_seq(), 1U);

  // The document equals the file: the next change continues from it.
  dispatch(setWidth("a", 30), "op-3");
  EXPECT_EQ(storedLog(id).size(), 2U);
  EXPECT_EQ(storedLog(id)[1].at("inverse"), setWidth("a", 10));
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
  EXPECT_EQ(changes[0].by_session_id(), "");

  // Repeated: the same summary, no second entry.
  ASSERT_TRUE(doc->rename("  New name ", key("rename-1")));
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeDocumentTest, RenameIsRefusedWhileATransactionIsOpenAndForAnEmptyName) {
  ASSERT_TRUE(doc->begin(writer, "T", step("b1"), options, &out));
  auto open = doc->rename("Other", key("rename-1"));
  ASSERT_FALSE(open.has_value());
  EXPECT_EQ(open.error().reason, ErrorReason::DocumentOpen);
  ASSERT_TRUE(doc->abort(writer, step("x1"), options, &out));

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
  ASSERT_TRUE(doc->undo(writer, key("op-3"), options, &out));
  v1::GetHistoryResponse history;
  doc->history(1, &history);
  ASSERT_EQ(history.entries_size(), 3);
  EXPECT_EQ(history.entries(2).kind(), v1::LogEntryView::KIND_UNDO);
  EXPECT_EQ(history.entries(2).target(), 2U);
  ASSERT_EQ(history.undo_stack_size(), 1);
  EXPECT_EQ(history.undo_stack(0), 1U);
  ASSERT_EQ(history.redo_stack_size(), 1);
  EXPECT_EQ(history.redo_stack(0), 2U);

  doc->history(3, &history);
  EXPECT_EQ(history.entries_size(), 1);
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
  ASSERT_TRUE(doc->begin(writer, "Edit sketch", step("b1"), options, &out));
  const auto seqBefore = doc->events().lastSeq();

  const Json edit{{"type", "feature.setParams"}, {"v", 2},         {"featureId", "s"},
                  {"typeVersion", 1},            {"params", conflictingSketchParams()}};
  auto refused = doc->apply(writer, edit, step("a1"), options, &out);
  ASSERT_FALSE(refused.has_value());
  EXPECT_EQ(refused.error().reason, ErrorReason::SketchNotSolved);
  ASSERT_EQ(refused.error().issues.size(), 1U);
  EXPECT_EQ(refused.error().issues[0].code, "sketch.notSolved");
  EXPECT_EQ(doc->events().lastSeq(), seqBefore);

  // The transaction is still open and empty: the commit writes nothing.
  ASSERT_TRUE(doc->commit(writer, step("c1"), options, &out));
  EXPECT_FALSE(out.has_entry());
  EXPECT_EQ(storedLog(id).size(), 1U);
}

}  // namespace
}  // namespace tinycad::session
