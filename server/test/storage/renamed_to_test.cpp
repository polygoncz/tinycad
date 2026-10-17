// renamedTo (port of the renamedTo part of test/unit/persistence/store.test.ts, M19.2 D5).

#include "renamed_to.hpp"

#include <gtest/gtest.h>

#include "storage/testing.hpp"

namespace tinycad::storage {
namespace {

using testing::anEntry;
using testing::documentRenameOp;

const Json other = {{"type", "studio.setRollback"}, {"v", 1}};

TEST(RenamedTo, IsTheNameOfTheLastDocumentRenameOfTheBatch) {
  const std::vector<StoredEntry> entries = {anEntry(1, std::nullopt, documentRenameOp("A")),
                                            anEntry(2, std::nullopt, other),
                                            anEntry(3, std::nullopt, documentRenameOp("B"))};
  EXPECT_EQ(renamedTo(entries), "B");
}

TEST(RenamedTo, IsEmptyForABatchWithoutDocumentRename) {
  const std::vector<StoredEntry> entries = {anEntry(1, std::nullopt, other)};
  EXPECT_EQ(renamedTo(entries), std::nullopt);
  EXPECT_EQ(renamedTo({}), std::nullopt);
}

TEST(RenamedTo, IgnoresADocumentRenameInsideABatchOperation) {
  const Json batch = {{"type", "batch"}, {"v", 1}, {"ops", {documentRenameOp("Inner")}}};
  const std::vector<StoredEntry> entries = {anEntry(1, std::nullopt, batch)};
  EXPECT_EQ(renamedTo(entries), std::nullopt);
}

TEST(RenamedTo, IgnoresBrokenEntries) {
  std::vector<StoredEntry> entries = {anEntry(1, std::nullopt, documentRenameOp("A"))};
  entries.push_back(StoredEntry{2, std::nullopt, Json("not an entry")});
  entries.push_back(StoredEntry{3, std::nullopt, Json{{"op", {{"type", "document.rename"}, {"name", 7}}}}});
  EXPECT_EQ(renamedTo(entries), "A");
}

}  // namespace
}  // namespace tinycad::storage
