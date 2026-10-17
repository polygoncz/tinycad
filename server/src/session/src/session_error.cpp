#include "tinycad/session/session_error.hpp"

#include <string>
#include <utility>

namespace tinycad::session {

namespace {

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

}  // namespace tinycad::session
