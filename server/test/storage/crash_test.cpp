// The crash test of M41: a helper process (crash_writer) writes K changes through
// PersistentDocument and kills itself with SIGKILL; reopening the file gives the same document,
// the same log and the same canUndo/canRedo as the same script played in this process, and undo
// reverts the last change. For K = 250 snapshots exist at 100 and 200 and loading replays only the
// rest.

#include <gtest/gtest.h>

#include <csignal>
#include <sstream>

#include "crash_script.hpp"
#include "storage/testing.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::storage {
namespace {

namespace crash = testing::crash;

std::vector<core::Json> logJson(const PersistentDocument& doc) {
  std::vector<core::Json> out;
  for (const auto& entry : doc.log().entries()) out.push_back(ops::logEntryJson(entry));
  return out;
}

void expectSameDocument(const PersistentDocument& reopened, const PersistentDocument& reference) {
  EXPECT_TRUE(document::sameStudio(*reopened.document().studio(), *reference.document().studio()));
  EXPECT_EQ(reopened.document().meta().name, reference.document().meta().name);
  EXPECT_EQ(reopened.log().lastSeq(), reference.log().lastSeq());
  EXPECT_EQ(reopened.canUndo(), reference.canUndo());
  EXPECT_EQ(reopened.canRedo(), reference.canRedo());
}

class CrashTest : public ::testing::TestWithParam<std::int64_t> {};

TEST_P(CrashTest, ReopeningAfterSigkillGivesTheSameDocumentLogAndUndo) {
  const std::int64_t count = GetParam();
  testing::TempDir crashed;
  const auto result = testing::runProcess(TINYCAD_CRASH_WRITER,
                                          {(crashed.path() / "docs").string(), std::to_string(count)},
                                          crashed.path() / "out.txt");
  ASSERT_TRUE(WIFSIGNALED(result.status)) << "exit status " << result.status;
  EXPECT_EQ(WTERMSIG(result.status), SIGKILL);
  // Every change was reported as written before the kill.
  std::istringstream lines(result.out);
  std::int64_t seq = 0;
  std::int64_t last = 0;
  while (lines >> seq) last = seq;
  EXPECT_EQ(last, count);

  // The reference: the same script in this process, over its own directory.
  testing::TempDir referenceDir;
  auto referenceCatalog = openSqliteCatalog(referenceDir.path(), crash::fixedClock);
  auto reference = crash::createDocument(*referenceCatalog, true);
  ASSERT_NE(reference, nullptr);
  for (std::int64_t step = 1; step <= count; ++step) ASSERT_TRUE(crash::runStep(*reference, step));

  auto catalog = openSqliteCatalog(crashed.path() / "docs", crash::fixedClock);
  auto file = catalog->open(crash::DOCUMENT_ID);
  ASSERT_TRUE(file.has_value()) << file.error().message;
  auto reopened = PersistentDocument::open(std::move(*file),
                                           {crash::schemas(), crash::handlers(), crash::fixedClock, true});
  ASSERT_TRUE(reopened.has_value()) << reopened.error().message;
  PersistentDocument& doc = **reopened;
  expectSameDocument(doc, *reference);
  EXPECT_EQ(logJson(doc), logJson(*reference));
  EXPECT_EQ(catalog->list().value()[0].lastSeq, count);

  // Undo reverts the last change on both.
  ASSERT_TRUE(doc.canUndo());
  ASSERT_TRUE(doc.undo({"undo-after-crash", "fp"}));
  ASSERT_TRUE(reference->undo({"undo-after-crash", "fp"}));
  expectSameDocument(doc, *reference);
}

TEST(CrashSnapshots, TwoHundredFiftyChangesHaveSnapshotsAt100And200AndLoadReplaysTheRest) {
  testing::TempDir dir;
  const auto result = testing::runProcess(TINYCAD_CRASH_WRITER, {dir.path().string(), "250"},
                                          dir.path() / "out.txt");
  ASSERT_TRUE(WIFSIGNALED(result.status));
  const auto file = dir.path() / "crash.tinycad.sqlite";
  EXPECT_EQ(testing::integerColumn(file, "SELECT at_seq FROM snapshots ORDER BY at_seq"),
            (std::vector<std::int64_t>{0, 100, 200}));
  auto stored = openSqliteCatalog(dir.path(), crash::fixedClock)->open(crash::DOCUMENT_ID).value()->load();
  ASSERT_TRUE(stored.has_value());
  EXPECT_EQ(stored->snapshot["atSeq"], 200);
  EXPECT_EQ(stored->entries.size(), 250U);
  // Entries 1..200 may be unreplayable: only the 50 after the snapshot are applied.
  for (std::size_t i = 0; i < 200; ++i) {
    stored->entries[i].entry["op"] = crash::rename("ghost", "never applied");
  }
  const PersistentDocument::Dependencies deps{crash::schemas(), crash::handlers(), crash::fixedClock, false};
  class Fixed final : public DocumentFile {
   public:
    explicit Fixed(StoredDocument stored) : stored_(std::move(stored)) {}
    [[nodiscard]] const DocumentId& id() const override { return crash::DOCUMENT_ID; }
    StoreResult<DocumentInfo> info() override { return DocumentInfo{}; }
    StoreResult<void> appendEntries(std::span<const StoredEntry>) override { return {}; }
    StoreResult<void> saveSnapshot(std::int64_t, const core::Json&) override { return {}; }
    StoreResult<StoredDocument> load() override { return stored_; }
    StoreResult<std::optional<StoredEntry>> findEntry(std::string_view) override {
      return std::optional<StoredEntry>();
    }

   private:
    StoredDocument stored_;
  };
  EXPECT_TRUE(PersistentDocument::open(std::make_unique<Fixed>(std::move(*stored)), deps).has_value());
}

INSTANTIATE_TEST_SUITE_P(Changes, CrashTest, ::testing::Values(1, 7, 250));

}  // namespace
}  // namespace tinycad::storage
