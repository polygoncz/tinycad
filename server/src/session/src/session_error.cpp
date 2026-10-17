#include "tinycad/session/session_error.hpp"

#include <exception>
#include <string>
#include <utility>

#include "google/rpc/status.pb.h"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

/** The one table of errors.proto: the gRPC code and the wire reason of each ErrorReason. */
struct WireReason {
  grpc::StatusCode code;
  v1::ErrorReason reason;
};

WireReason wireReason(ErrorReason reason) {
  using grpc::StatusCode;
  switch (reason) {
    case ErrorReason::InvalidOperation:
      return {StatusCode::INVALID_ARGUMENT, v1::ERROR_REASON_INVALID_OPERATION};
    case ErrorReason::UnknownTarget:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_UNKNOWN_TARGET};
    case ErrorReason::ReadOnly:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_READ_ONLY};
    case ErrorReason::TransactionOpen:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_TRANSACTION_OPEN};
    case ErrorReason::NoTransaction:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_NO_TRANSACTION};
    case ErrorReason::NothingToUndo:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_NOTHING_TO_UNDO};
    case ErrorReason::NothingToRedo:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_NOTHING_TO_REDO};
    case ErrorReason::OperationIdReused:
      return {StatusCode::INVALID_ARGUMENT, v1::ERROR_REASON_OPERATION_ID_REUSED};
    case ErrorReason::SketchNotSolved:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_SKETCH_NOT_SOLVED};
    case ErrorReason::SessionNotFound:
      return {StatusCode::NOT_FOUND, v1::ERROR_REASON_SESSION_NOT_FOUND};
    case ErrorReason::DocumentNotFound:
      return {StatusCode::NOT_FOUND, v1::ERROR_REASON_DOCUMENT_NOT_FOUND};
    case ErrorReason::InvalidDocument:
      return {StatusCode::INVALID_ARGUMENT, v1::ERROR_REASON_INVALID_DOCUMENT};
    case ErrorReason::DocumentOpen:
      return {StatusCode::FAILED_PRECONDITION, v1::ERROR_REASON_DOCUMENT_OPEN};
    case ErrorReason::Storage:
      return {StatusCode::UNAVAILABLE, v1::ERROR_REASON_STORAGE};
    case ErrorReason::Internal:
      break;
  }
  return {StatusCode::INTERNAL, v1::ERROR_REASON_UNSPECIFIED};
}

/** ParamIssue.params (an object of strings and numbers, or null) → ParamIssue.values. */
void issueToProto(const document::ParamIssue& issue, v1::ParamIssue* out) {
  out->set_param(issue.param);
  out->set_code(issue.code);
  if (!issue.params.is_object()) return;
  auto& values = *out->mutable_values();
  for (const auto& item : issue.params.items()) {
    v1::ParamIssueValue& value = values[item.key()];
    if (item.value().is_number()) {
      value.set_number(item.value().get<double>());
    } else if (item.value().is_string()) {
      value.set_text(item.value().get<std::string>());
    } else {
      // Not produced by the domain today; keep the text rather than lose the value.
      value.set_text(item.value().dump());
    }
  }
}

/**
 * Load issues → ParamIssues { param: <prefix><path>, code: 'document.loadIssue', params: {
 * message } }; ErrorDetail.path = the first path.
 */
SessionError loadIssuesError(ErrorReason reason,
                             const std::vector<document::DocumentLoadIssue>& issues,
                             const std::string& prefix, std::string message) {
  SessionError error{reason, {}, {}, std::move(message)};
  for (const auto& issue : issues) {
    std::string param = prefix;
    if (!param.empty() && !issue.path.empty()) param += ".";
    param += issue.path;
    error.issues.push_back(
        {param, "document.loadIssue", core::Json{{"message", issue.message}}});
  }
  if (!error.issues.empty()) error.path = error.issues.front().param;
  return error;
}

}  // namespace

SessionError fromChangeError(const storage::ChangeError& error) {
  using storage::ChangeErrorCode;
  ErrorReason reason = ErrorReason::Internal;
  switch (error.code) {
    case ChangeErrorCode::InvalidOperation:
      reason = ErrorReason::InvalidOperation;
      break;
    case ChangeErrorCode::TransactionOpen:
      reason = ErrorReason::TransactionOpen;
      break;
    case ChangeErrorCode::NoTransaction:
      reason = ErrorReason::NoTransaction;
      break;
    case ChangeErrorCode::NothingToUndo:
      reason = ErrorReason::NothingToUndo;
      break;
    case ChangeErrorCode::NothingToRedo:
      reason = ErrorReason::NothingToRedo;
      break;
    case ChangeErrorCode::OperationIdReused:
      reason = ErrorReason::OperationIdReused;
      break;
    case ChangeErrorCode::Storage:
      reason = ErrorReason::Storage;
      break;
  }
  const std::string path = reason == ErrorReason::InvalidOperation ? error.path : std::string();
  return {reason, path, {}, error.message};
}

SessionError fromServiceError(const storage::ServiceError& error) {
  using storage::ServiceErrorCode;
  switch (error.code) {
    case ServiceErrorCode::NotFound:
      return {ErrorReason::DocumentNotFound, {}, {}, error.message};
    case ServiceErrorCode::InvalidDocument:
    case ServiceErrorCode::BrokenDocument:
      return loadIssuesError(ErrorReason::InvalidDocument, error.issues, {}, error.message);
    case ServiceErrorCode::InvalidName:
      return {ErrorReason::InvalidOperation, "name", {}, error.message};
    case ServiceErrorCode::OperationIdReused:
      return {ErrorReason::OperationIdReused, {}, {}, error.message};
    case ServiceErrorCode::Storage:
      break;
  }
  return {ErrorReason::Storage, {}, {}, error.message};
}

SessionError fromLoadError(const storage::LoadError& error) {
  using Kind = storage::LoadError::Kind;
  if (error.kind == Kind::Storage) return {ErrorReason::Storage, {}, {}, error.message};
  const std::string prefix =
      error.kind == Kind::Entry ? "entries[" + std::to_string(error.seq) + "]" : std::string();
  return loadIssuesError(ErrorReason::InvalidDocument, error.issues, prefix, error.message);
}

SessionError fromSketchNotSolved(const features::SketchNotSolved& error) {
  return {ErrorReason::SketchNotSolved, {}, error.issues, error.message};
}

grpc::Status toStatus(const SessionError& error) {
  const WireReason wire = wireReason(error.reason);
  v1::ErrorDetail detail;
  detail.set_reason(wire.reason);
  detail.set_path(error.path);
  for (const auto& issue : error.issues) issueToProto(issue, detail.add_issues());

  google::rpc::Status status;
  status.set_code(static_cast<int>(wire.code));
  status.set_message(error.message);
  status.add_details()->PackFrom(detail);
  // The serialized google.rpc.Status travels in the grpc-status-details-bin trailer (as M39).
  return {wire.code, error.message, status.SerializeAsString()};
}

grpc::Status internalStatusOfCurrentException() {
  std::string message = "unknown exception";
  try {
    throw;
  } catch (const std::exception& e) {
    message = e.what();
  } catch (...) {
  }
  return toStatus({ErrorReason::Internal, {}, {}, message});
}

}  // namespace tinycad::session
