// SessionManager (spec 14 "Sezení", "Vlákna a zámky serveru"; Q102, decisions N54, N56, N59,
// N70, N106): sessions over shared runtime documents, the edit lease, resume, the catalog as the
// one door to the documents, and the lock rules under concurrency.

#include "tinycad/session/session_manager.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <future>
#include <thread>

#include "session/runtime_testing.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class SessionManagerTest : public RuntimeFixture {
 protected:
  SteadyTime steadyNow{};
  int nextSession = 0;
  std::unique_ptr<SessionManager> manager = std::make_unique<SessionManager>(
      SessionManager::Dependencies{deps, documents, [this] { return steadyNow; },
                                   [this] { return "s" + std::to_string(++nextSession); },
                                   SessionConfig{}});
  document::DocumentId part = createDocument("Part");
  v1::ReadModelOptions options;
  v1::ChangeResult out;

  SessionPtr open(const document::DocumentId& id, const std::string& resume = {}) {
    auto opened = manager->open(id, std::nullopt, resume);
    EXPECT_TRUE(opened.has_value()) << (opened ? "" : opened.error().message);
    return opened ? opened->session : nullptr;
  }

  SessionResult<void> dispatch(const SessionPtr& session, const Json& op, const std::string& id) {
    return session->document().dispatch(session->caller(), op, "", key(id), options, &out);
  }
};

TEST_F(SessionManagerTest, TheFirstSessionGetsTheLeaseTheSecondIsReadOnly) {
  const SessionPtr first = open(part);
  const SessionPtr second = open(part);
  EXPECT_EQ(first->id().str(), "s1");
  EXPECT_TRUE(first->writable());
  EXPECT_FALSE(second->writable());
  EXPECT_EQ(&first->document(), &second->document());
  EXPECT_TRUE(manager->isLoaded(part));
  EXPECT_EQ(manager->sessionCount(), 2U);

  EXPECT_TRUE(dispatch(first, addBox("a", 0), "op-1"));
  auto refused = dispatch(second, addBox("b", 1), "op-2");
  ASSERT_FALSE(refused.has_value());
  EXPECT_EQ(refused.error().reason, ErrorReason::ReadOnly);
}

TEST_F(SessionManagerTest, AChangeIsAnnouncedToTheReadOnlySessionWithTheWriterId) {
  const SessionPtr writer = open(part);
  const SessionPtr reader = open(part);
  ASSERT_TRUE(dispatch(writer, addBox("a", 0), "op-1"));
  const auto changes = changedOf(reader->document());
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].by_session_id(), writer->id().str());
}

TEST_F(SessionManagerTest, WhenTheWriterLeavesTheReadOnlySessionStaysReadOnly) {
  const SessionPtr writer = open(part);
  const SessionPtr reader = open(part);
  manager->close(writer->id().str());

  EXPECT_FALSE(reader->document().leaseHolder().has_value());
  EXPECT_FALSE(reader->writable());
  EXPECT_EQ(dispatch(reader, addBox("a", 0), "op-1").error().reason, ErrorReason::ReadOnly);

  const SessionPtr next = open(part);
  EXPECT_TRUE(next->writable());
  EXPECT_TRUE(dispatch(next, addBox("a", 0), "op-1"));
}

TEST_F(SessionManagerTest, CloseIsIdempotentAndTheLastSessionUnloadsTheDocument) {
  const SessionPtr session = open(part);
  const std::shared_ptr<RuntimeDocument> runtime = session->documentPtr();
  manager->close("unknown");
  manager->close(session->id().str());
  manager->close(session->id().str());

  EXPECT_FALSE(manager->isLoaded(part));
  EXPECT_EQ(manager->sessionCount(), 0U);
  EXPECT_TRUE(runtime->events().closed());
  auto found = manager->find(session->id().str());
  ASSERT_FALSE(found.has_value());
  EXPECT_EQ(found.error().reason, ErrorReason::SessionNotFound);
}

TEST_F(SessionManagerTest, ClosingTheWriterAbortsItsTransaction) {
  const SessionPtr writer = open(part);
  const SessionPtr reader = open(part);
  ASSERT_TRUE(writer->document().begin(writer->caller(), "T", {writer->recent(), key("b1")},
                                       options, &out));
  manager->close(writer->id().str());
  v1::ReadModel model;
  ASSERT_TRUE(reader->document().readModel(reader->caller(), options, &model));
  EXPECT_FALSE(model.session().has_transaction());
}

TEST_F(SessionManagerTest, OpeningAMissingDocumentKeepsNothing) {
  auto missing = manager->open(document::DocumentId("nope"), std::nullopt, "");
  ASSERT_FALSE(missing.has_value());
  EXPECT_EQ(missing.error().reason, ErrorReason::DocumentNotFound);
  EXPECT_FALSE(manager->isLoaded(document::DocumentId("nope")));
  EXPECT_EQ(manager->sessionCount(), 0U);
}

TEST_F(SessionManagerTest, TheQualityOfTheSessionIsTheRequestedOneOrTheDefault) {
  auto custom = manager->open(part, kernel::MeshQuality{0.01, 0.2}, "");
  ASSERT_TRUE(custom.has_value());
  EXPECT_EQ(custom->session->caller().quality.linearDeflection, 0.01);
  EXPECT_EQ(open(part)->caller().quality.linearDeflection,
            manager->config().defaultQuality.linearDeflection);
}

// --- resume (N56, N70) --------------------------------------------------------------------

TEST_F(SessionManagerTest, ResumingALiveSessionOfTheSameDocumentReturnsItWithTheLease) {
  const SessionPtr writer = open(part);
  auto resumed = manager->open(part, std::nullopt, writer->id().str());
  ASSERT_TRUE(resumed.has_value());
  EXPECT_TRUE(resumed->resumed);
  EXPECT_EQ(resumed->session, writer);
  EXPECT_TRUE(resumed->session->writable());
  EXPECT_EQ(manager->sessionCount(), 1U);
}

TEST_F(SessionManagerTest, ResumingAnUnknownOrForeignSessionOpensANewOne) {
  const document::DocumentId other = createDocument("Other");
  const SessionPtr onOther = open(other);

  auto foreign = manager->open(part, std::nullopt, onOther->id().str());
  ASSERT_TRUE(foreign.has_value());
  EXPECT_FALSE(foreign->resumed);
  EXPECT_NE(foreign->session, onOther);
  EXPECT_TRUE(foreign->session->writable());

  auto unknown = manager->open(part, std::nullopt, "gone");
  ASSERT_TRUE(unknown.has_value());
  EXPECT_FALSE(unknown->resumed);
  EXPECT_EQ(manager->sessionCount(), 3U);
}

// --- the catalog --------------------------------------------------------------------------

TEST_F(SessionManagerTest, RenamingAnOpenDocumentGoesThroughItsRuntimeDocument) {
  const SessionPtr session = open(part);
  auto renamed = manager->renameDocument(part, "Renamed", key("rename-1"));
  ASSERT_TRUE(renamed.has_value()) << renamed.error().message;
  EXPECT_EQ(renamed->name, "Renamed");
  const auto changes = changedOf(session->document());
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].by_session_id(), "");
  v1::ReadModel model;
  ASSERT_TRUE(session->document().readModel(session->caller(), options, &model));
  EXPECT_EQ(model.document().name(), "Renamed");
  EXPECT_EQ(storedLog(part).size(), 1U);
}

TEST_F(SessionManagerTest, RenamingAClosedDocumentWritesTheFile) {
  auto renamed = manager->renameDocument(part, "Renamed", key("rename-1"));
  ASSERT_TRUE(renamed.has_value());
  EXPECT_EQ(stored(part)->document().meta().name, "Renamed");
  auto missing = manager->renameDocument(document::DocumentId("nope"), "X", key("rename-2"));
  ASSERT_FALSE(missing.has_value());
  EXPECT_EQ(missing.error().reason, ErrorReason::DocumentNotFound);
}

TEST_F(SessionManagerTest, AnOpenDocumentCannotBeRemovedAClosedOneCan) {
  const SessionPtr session = open(part);
  auto refused = manager->removeDocument(part);
  ASSERT_FALSE(refused.has_value());
  EXPECT_EQ(refused.error().reason, ErrorReason::DocumentOpen);

  manager->close(session->id().str());
  EXPECT_TRUE(manager->removeDocument(part));
  EXPECT_TRUE(manager->listDocuments().value().empty());
  EXPECT_TRUE(manager->removeDocument(part));  // a missing document succeeds
}

TEST_F(SessionManagerTest, CreateListImportAndExportGoToTheCatalogService) {
  ASSERT_TRUE(manager->createDocument("Second", key("create-x")));
  EXPECT_EQ(manager->listDocuments().value().size(), 2U);
  const auto exported = manager->exportDocument(part).value();
  EXPECT_EQ(exported.fileName, "Part.tinycad.json");
  const auto imported =
      manager->importDocument(exported.content, storage::importKey(exported.content)).value();
  EXPECT_EQ(imported.name, "Part");
  EXPECT_EQ(manager->listDocuments().value().size(), 3U);
}

// --- shutdown and destruction (N106) ------------------------------------------------------

TEST_F(SessionManagerTest, ShutdownClosesTheEventsOfEveryLoadedDocument) {
  const SessionPtr session = open(part);
  manager->shutdown();
  EXPECT_TRUE(session->document().events().closed());
  EXPECT_EQ(manager->sessionCount(), 1U);
}

TEST_F(SessionManagerTest, DestroyingTheManagerClosesEverySession) {
  const SessionPtr writer = open(part);
  ASSERT_TRUE(writer->document().begin(writer->caller(), "T", {writer->recent(), key("b1")},
                                       options, &out));
  const std::shared_ptr<RuntimeDocument> runtime = writer->documentPtr();
  manager.reset();
  EXPECT_FALSE(runtime->leaseHolder().has_value());
  EXPECT_TRUE(runtime->events().closed());
}

// --- concurrency (N54, N106) --------------------------------------------------------------

TEST_F(SessionManagerTest, TwoSessionsOpeningAtOnceShareOneDocumentAndOneLease) {
  const auto openPart = [&] { return manager->open(part, std::nullopt, ""); };
  auto first = std::async(std::launch::async, openPart);
  auto second = std::async(std::launch::async, openPart);
  auto a = first.get();
  auto b = second.get();
  ASSERT_TRUE(a.has_value());
  ASSERT_TRUE(b.has_value());
  EXPECT_EQ(&a->session->document(), &b->session->document());
  EXPECT_NE(a->session->writable(), b->session->writable());
}

TEST_F(SessionManagerTest, TwoThreadsApplyingTheSameOperationIdApplyItOnce) {
  const SessionPtr writer = open(part);
  ASSERT_TRUE(writer->document().begin(writer->caller(), "T", {writer->recent(), key("b1")},
                                       options, &out));
  const auto changesBefore = changedOf(writer->document()).size();
  const auto applyOnce = [&] {
    v1::ChangeResult result;
    // A second application of the same feature.add would fail with a duplicate id.
    return writer->document()
        .apply(writer->caller(), addBox("a", 0), {writer->recent(), key("a1")}, options, &result)
        .has_value();
  };
  auto first = std::async(std::launch::async, applyOnce);
  auto second = std::async(std::launch::async, applyOnce);
  EXPECT_TRUE(first.get());
  EXPECT_TRUE(second.get());
  EXPECT_EQ(changedOf(writer->document()).size(), changesBefore + 1);
}

TEST_F(SessionManagerTest, AChangeRunningInTheKernelNeverBlocksTheManager) {
  const SessionPtr writer = open(part);
  const document::DocumentId other = createDocument("Other");
  gate->close();
  auto change = std::async(std::launch::async, [&] {
    v1::ChangeResult result;
    return writer->document()
        .dispatch(writer->caller(), addBox("a", 0), "", key("op-1"), options, &result)
        .has_value();
  });
  ASSERT_TRUE(gate->someoneWaits());

  // The change holds the document lock inside makeBox; the manager answers meanwhile.
  auto managerCalls = std::async(std::launch::async, [&] {
    const bool found = manager->find(writer->id().str()).has_value();
    const SessionPtr reader = open(part);  // the lease is a leaf lock, not the document lock
    const SessionPtr onOther = open(other);
    manager->close(onOther->id().str());
    return found && reader != nullptr && !reader->writable() &&
           manager->listDocuments().has_value() && manager->sessionCount() == 2U;
  });
  const auto status = managerCalls.wait_for(std::chrono::seconds(10));
  gate->open();
  ASSERT_EQ(status, std::future_status::ready) << "the manager waited for the document lock";
  EXPECT_TRUE(managerCalls.get());
  EXPECT_TRUE(change.get());
}

}  // namespace
}  // namespace tinycad::session
