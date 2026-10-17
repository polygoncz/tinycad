// SessionError → google.rpc.Status (the one table of errors.proto) and the mappings of the
// storage errors (spec 14 "Chyby").

#include "tinycad/session/session_error.hpp"

#include <gtest/gtest.h>

#include <stdexcept>
#include <string>
#include <vector>

#include "google/rpc/status.pb.h"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::session {
namespace {

namespace v1 = tinycad::v1;
using core::Json;

/** The one ErrorDetail of a failed status. */
v1::ErrorDetail detailOf(const grpc::Status& status) {
  google::rpc::Status rpc;
  EXPECT_TRUE(rpc.ParseFromString(status.error_details()));
  EXPECT_EQ(rpc.code(), static_cast<int>(status.error_code()));
  EXPECT_EQ(rpc.details_size(), 1);
  v1::ErrorDetail detail;
  if (rpc.details_size() > 0) {
    EXPECT_TRUE(rpc.details(0).UnpackTo(&detail));
  }
  return detail;
}

struct Row {
  ErrorReason reason;
  grpc::StatusCode code;
  v1::ErrorReason wire;
};

TEST(ToStatus, MapsEveryReasonByTheTableOfErrorsProto) {
  using grpc::StatusCode;
  const std::vector<Row> rows = {
      {ErrorReason::InvalidOperation, StatusCode::INVALID_ARGUMENT,
       v1::ERROR_REASON_INVALID_OPERATION},
      {ErrorReason::UnknownTarget, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_UNKNOWN_TARGET},
      {ErrorReason::ReadOnly, StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_READ_ONLY},
      {ErrorReason::TransactionOpen, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_TRANSACTION_OPEN},
      {ErrorReason::NoTransaction, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_NO_TRANSACTION},
      {ErrorReason::NothingToUndo, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_NOTHING_TO_UNDO},
      {ErrorReason::NothingToRedo, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_NOTHING_TO_REDO},
      {ErrorReason::OperationIdReused, StatusCode::INVALID_ARGUMENT,
       v1::ERROR_REASON_OPERATION_ID_REUSED},
      {ErrorReason::SketchNotSolved, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_SKETCH_NOT_SOLVED},
      {ErrorReason::SessionNotFound, StatusCode::NOT_FOUND, v1::ERROR_REASON_SESSION_NOT_FOUND},
      {ErrorReason::DocumentNotFound, StatusCode::NOT_FOUND, v1::ERROR_REASON_DOCUMENT_NOT_FOUND},
      {ErrorReason::InvalidDocument, StatusCode::INVALID_ARGUMENT,
       v1::ERROR_REASON_INVALID_DOCUMENT},
      {ErrorReason::DocumentOpen, StatusCode::FAILED_PRECONDITION,
       v1::ERROR_REASON_DOCUMENT_OPEN},
      {ErrorReason::Storage, StatusCode::UNAVAILABLE, v1::ERROR_REASON_STORAGE},
      {ErrorReason::Internal, StatusCode::INTERNAL, v1::ERROR_REASON_UNSPECIFIED},
  };
  for (const auto& row : rows) {
    const grpc::Status status = toStatus({row.reason, "op.x", {}, "technical text"});
    EXPECT_EQ(status.error_code(), row.code) << v1::ErrorReason_Name(row.wire);
    EXPECT_EQ(status.error_message(), "technical text");
    const v1::ErrorDetail detail = detailOf(status);
    EXPECT_EQ(detail.reason(), row.wire);
    EXPECT_EQ(detail.path(), "op.x");
    EXPECT_EQ(detail.issues_size(), 0);
  }
}

TEST(ToStatus, CarriesTheIssuesWithTheirValues) {
  const SessionError error{ErrorReason::SketchNotSolved,
                           "",
                           {{"sketch", "sketch.notSolved", nullptr},
                            {"width", "param.atOrBelowMin", Json{{"min", 0}, {"unit", "mm"}}}},
                           ""};
  const v1::ErrorDetail detail = detailOf(toStatus(error));
  ASSERT_EQ(detail.issues_size(), 2);
  EXPECT_EQ(detail.issues(0).param(), "sketch");
  EXPECT_EQ(detail.issues(0).code(), "sketch.notSolved");
  EXPECT_TRUE(detail.issues(0).values().empty());
  EXPECT_EQ(detail.issues(1).param(), "width");
  EXPECT_EQ(detail.issues(1).code(), "param.atOrBelowMin");
  EXPECT_EQ(detail.issues(1).values().at("min").number(), 0.0);
  EXPECT_EQ(detail.issues(1).values().at("min").value_case(), v1::ParamIssueValue::kNumber);
  EXPECT_EQ(detail.issues(1).values().at("unit").text(), "mm");
}

TEST(InternalStatusOfCurrentException, IsInternalWithTheExceptionText) {
  grpc::Status status;
  try {
    throw std::runtime_error("boom");
  } catch (...) {
    status = internalStatusOfCurrentException();
  }
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INTERNAL);
  EXPECT_EQ(status.error_message(), "boom");
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_UNSPECIFIED);
}

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
  EXPECT_EQ(detailOf(toStatus(error)).issues(0).param(), "sketch");
}

}  // namespace
}  // namespace tinycad::session
