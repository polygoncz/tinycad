// The mappings of the storage and sketch errors to SessionError (spec 14 "Chyby"); SessionError →
// google.rpc.Status is tested in test/rpc/status_test.cpp.

#include "tinycad/session/session_error.hpp"

#include <gtest/gtest.h>

#include <string>
#include <utility>
#include <vector>

namespace tinycad::session {
namespace {

using core::Json;

TEST(FromChangeError, MapsEveryCodeOneToOne) {
  using storage::ChangeErrorCode;
  const std::vector<std::pair<ChangeErrorCode, ErrorReason>> rows = {
      {ChangeErrorCode::InvalidOperation, ErrorReason::InvalidOperation},
      {ChangeErrorCode::TransactionOpen, ErrorReason::TransactionOpen},
      {ChangeErrorCode::NoTransaction, ErrorReason::NoTransaction},
      {ChangeErrorCode::NothingToUndo, ErrorReason::NothingToUndo},
      {ChangeErrorCode::NothingToRedo, ErrorReason::NothingToRedo},
      {ChangeErrorCode::OperationIdReused, ErrorReason::OperationIdReused},
      {ChangeErrorCode::Storage, ErrorReason::Storage},
  };
  for (const auto& [code, reason] : rows) {
    EXPECT_EQ(fromChangeError({code, "", "m"}).reason, reason);
  }
}

TEST(FromChangeError, InvalidOperationKeepsThePath) {
  const SessionError error =
      fromChangeError({storage::ChangeErrorCode::InvalidOperation, "ops[1].feature.params", "m"});
  EXPECT_EQ(error.path, "ops[1].feature.params");
  EXPECT_EQ(error.message, "m");
}

TEST(FromServiceError, MapsEveryCode) {
  using storage::ServiceErrorCode;
  EXPECT_EQ(fromServiceError({ServiceErrorCode::NotFound, {}, ""}).reason,
            ErrorReason::DocumentNotFound);
  EXPECT_EQ(fromServiceError({ServiceErrorCode::OperationIdReused, {}, ""}).reason,
            ErrorReason::OperationIdReused);
  EXPECT_EQ(fromServiceError({ServiceErrorCode::Storage, {}, ""}).reason, ErrorReason::Storage);
  EXPECT_EQ(fromServiceError({ServiceErrorCode::BrokenDocument, {}, ""}).reason,
            ErrorReason::InvalidDocument);

  const SessionError name = fromServiceError({ServiceErrorCode::InvalidName, {}, ""});
  EXPECT_EQ(name.reason, ErrorReason::InvalidOperation);
  EXPECT_EQ(name.path, "name");
}

TEST(FromServiceError, InvalidDocumentCarriesTheLoadIssues) {
  const SessionError error = fromServiceError(
      {storage::ServiceErrorCode::InvalidDocument,
       {{"document.studio.features[0].id", "Must be a string"}, {"formatVersion", "Unknown"}},
       ""});
  EXPECT_EQ(error.reason, ErrorReason::InvalidDocument);
  EXPECT_EQ(error.path, "document.studio.features[0].id");
  ASSERT_EQ(error.issues.size(), 2u);
  EXPECT_EQ(error.issues[0].param, "document.studio.features[0].id");
  EXPECT_EQ(error.issues[0].code, "document.loadIssue");
  EXPECT_EQ(error.issues[0].params, (Json{{"message", "Must be a string"}}));
  EXPECT_EQ(error.issues[1].param, "formatVersion");
}

TEST(FromLoadError, StorageIsStorage) {
  EXPECT_EQ(fromLoadError({storage::LoadError::Kind::Storage, 0, {}, "io"}).reason,
            ErrorReason::Storage);
}

TEST(FromLoadError, ASnapshotIssueKeepsItsPath) {
  const SessionError error =
      fromLoadError({storage::LoadError::Kind::Snapshot, 0, {{"atSeq", "Must be a number"}}, ""});
  EXPECT_EQ(error.reason, ErrorReason::InvalidDocument);
  EXPECT_EQ(error.path, "atSeq");
  ASSERT_EQ(error.issues.size(), 1u);
  EXPECT_EQ(error.issues[0].param, "atSeq");
}

TEST(FromLoadError, EntryIssuesArePrefixedWithTheSeqOfTheEntry) {
  const SessionError error = fromLoadError(
      {storage::LoadError::Kind::Entry, 7, {{"op", "Unknown operation"}, {"", "Broken"}}, ""});
  EXPECT_EQ(error.reason, ErrorReason::InvalidDocument);
  EXPECT_EQ(error.path, "entries[7].op");
  ASSERT_EQ(error.issues.size(), 2u);
  EXPECT_EQ(error.issues[0].param, "entries[7].op");
  EXPECT_EQ(error.issues[1].param, "entries[7]");
}

TEST(FromLoadError, BaseIsInvalidDocument) {
  EXPECT_EQ(fromLoadError({storage::LoadError::Kind::Base, 0, {}, ""}).reason,
            ErrorReason::InvalidDocument);
}

TEST(FromSketchNotSolved, CarriesTheIssues) {
  const features::SketchNotSolved notSolved{
      document::FeatureId("s1"), "conflict", {{"sketch", "sketch.notSolved", nullptr}}};
  const SessionError error = fromSketchNotSolved(notSolved);
  EXPECT_EQ(error.reason, ErrorReason::SketchNotSolved);
  ASSERT_EQ(error.issues.size(), 1u);
  EXPECT_EQ(error.issues[0].code, "sketch.notSolved");
}

}  // namespace
}  // namespace tinycad::session
