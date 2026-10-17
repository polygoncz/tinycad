#include "tinycad/rpc/status.hpp"

#include <exception>
#include <string>

#include "convert.hpp"
#include "google/rpc/status.pb.h"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using geometry::ErrorCode;
using session::ErrorReason;

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

/** The text of the exception being handled (called inside a catch). */
std::string currentExceptionText() {
  std::string message = "unknown exception";
  try {
    throw;
  } catch (const std::exception& e) {
    message = e.what();
  } catch (...) {
  }
  return message;
}

}  // namespace

// --- SessionService and DocumentService ---------------------------------------------------

grpc::Status toStatus(const session::SessionError& error) {
  const WireReason wire = wireReason(error.reason);
  v1::ErrorDetail detail;
  detail.set_reason(wire.reason);
  detail.set_path(error.path);
  for (const auto& issue : error.issues) issueToProto(issue, detail.add_issues());
  return errorStatus(wire.code, error.message, detail);
}

grpc::Status internalStatusOfCurrentException() {
  return toStatus({ErrorReason::Internal, {}, {}, currentExceptionText()});
}

// --- every service and GeometryService ----------------------------------------------------

grpc::Status errorStatus(grpc::StatusCode code, const std::string& message,
                         const v1::ErrorDetail& detail) {
  google::rpc::Status status;
  status.set_code(static_cast<int>(code));
  status.set_message(message);
  status.add_details()->PackFrom(detail);
  // The serialized google.rpc.Status travels in the grpc-status-details-bin trailer.
  return {code, message, status.SerializeAsString()};
}

grpc::Status geometryStatus(const geometry::GeometryError& error, const std::string& path) {
  v1::ErrorDetail detail;
  detail.set_path(path);
  grpc::StatusCode code = grpc::StatusCode::INTERNAL;
  switch (error.code) {
    case ErrorCode::InvalidInput:
      code = grpc::StatusCode::INVALID_ARGUMENT;
      detail.set_reason(v1::ERROR_REASON_KERNEL_INVALID_INPUT);
      break;
    case ErrorCode::OperationFailed:
      code = grpc::StatusCode::FAILED_PRECONDITION;
      detail.set_reason(v1::ERROR_REASON_KERNEL_OPERATION_FAILED);
      break;
    case ErrorCode::Internal:
      detail.set_reason(v1::ERROR_REASON_KERNEL_INTERNAL);
      break;
  }
  return errorStatus(code, error.message, detail);
}

grpc::Status internalGeometryStatusOfCurrentException() {
  return geometryStatus({ErrorCode::Internal, currentExceptionText()});
}

}  // namespace tinycad::rpc
