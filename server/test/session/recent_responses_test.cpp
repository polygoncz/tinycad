// In-memory idempotence of the transaction steps (spec 14 "Idempotence", N58).

#include "tinycad/session/recent_responses.hpp"

#include <gtest/gtest.h>

#include <string>

#include "tinycad/core/result.hpp"

namespace tinycad::session {
namespace {

using Lookup = RecentResponses::Lookup;

storage::OperationKey key(const std::string& id, const std::string& fingerprint = "fp") {
  return {id, fingerprint};
}

TEST(RecentResponses, AnUnknownIdIsNew) {
  const RecentResponses recent;
  EXPECT_EQ(recent.lookup(key("a")), Lookup::New);
}

TEST(RecentResponses, ARememberedIdWithTheSameFingerprintIsRepeated) {
  RecentResponses recent;
  recent.remember(key("a"));
  EXPECT_EQ(recent.lookup(key("a")), Lookup::Repeated);
}

TEST(RecentResponses, ARememberedIdWithAnotherFingerprintIsReused) {
  RecentResponses recent;
  recent.remember(key("a", "fp1"));
  EXPECT_EQ(recent.lookup(key("a", "fp2")), Lookup::Reused);
}

TEST(RecentResponses, TheOldestLeavesAfter64) {
  RecentResponses recent;
  for (int i = 0; i < 64; ++i) recent.remember(key("id" + std::to_string(i)));
  EXPECT_EQ(recent.size(), 64u);
  EXPECT_EQ(recent.lookup(key("id0")), Lookup::Repeated);

  recent.remember(key("id64"));
  EXPECT_EQ(recent.size(), 64u);
  EXPECT_EQ(recent.lookup(key("id0")), Lookup::New);
  EXPECT_EQ(recent.lookup(key("id1")), Lookup::Repeated);
  EXPECT_EQ(recent.lookup(key("id64")), Lookup::Repeated);
}

TEST(RecentResponses, RememberingAKeptIdDoesNotGrow) {
  RecentResponses recent(2);
  recent.remember(key("a"));
  recent.remember(key("a"));
  recent.remember(key("b"));
  EXPECT_EQ(recent.size(), 2u);
  EXPECT_EQ(recent.lookup(key("a")), Lookup::Repeated);
}

TEST(RecentResponses, ACapacityOfZeroIsAProgrammerError) {
  EXPECT_THROW(RecentResponses(0), core::AssertionError);
}

}  // namespace
}  // namespace tinycad::session
