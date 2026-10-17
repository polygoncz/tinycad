// snapshotSeqsToKeep (port of the snapshotSeqsToKeep part of test/unit/persistence/store.test.ts,
// Q009).

#include "snapshot_keep.hpp"

#include <gtest/gtest.h>

namespace tinycad::storage {
namespace {

using Seqs = std::vector<std::int64_t>;

TEST(SnapshotSeqsToKeep, KeepsTheBaseAndTheThreeWithTheHighestAtSeq) {
  EXPECT_EQ(snapshotSeqsToKeep({0, 100, 200, 300, 400}), (Seqs{0, 200, 300, 400}));
}

TEST(SnapshotSeqsToKeep, DecidesByAtSeqNotByOrderOfWriting) {
  EXPECT_EQ(snapshotSeqsToKeep({0, 400, 100, 300, 200}), (Seqs{0, 200, 300, 400}));
}

TEST(SnapshotSeqsToKeep, KeepsEverythingWhileThereAreAtMostThreeBesidesTheBase) {
  EXPECT_EQ(snapshotSeqsToKeep({0, 5, 9, 7}), (Seqs{0, 5, 7, 9}));
}

TEST(SnapshotSeqsToKeep, WithoutABaseKeepsOnlyTheThreeHighest) {
  EXPECT_EQ(snapshotSeqsToKeep({1, 2, 3, 4}), (Seqs{2, 3, 4}));
  EXPECT_EQ(snapshotSeqsToKeep({}), Seqs{});
}

}  // namespace
}  // namespace tinycad::storage
