#include "status.hpp"

#include <exception>

#include "google/rpc/status.pb.h"

namespace tinycad::service {

namespace v1 = tinycad::v1;
using geometry::ErrorCode;

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

grpc::Status internalStatusOfCurrentException() {
  std::string message = "unknown exception";
  try {
    throw;
  } catch (const std::exception& e) {
    message = e.what();
  } catch (...) {
  }
  return geometryStatus({ErrorCode::Internal, message});
}

}  // namespace tinycad::service
