#pragma once

// Errors of the RPCs as google.rpc.Status with an ErrorDetail (errors.proto, spec 14 "Chyby"):
// the gRPC code says what the client may do, ErrorDetail.reason which domain error it is.
// Internal to tinycad_service.

#include <grpcpp/support/status.h>

#include <string>

#include "tinycad/geometry/geometry.hpp"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::service {

/** A failed RPC: the code, the technical message and one ErrorDetail in the status details. */
grpc::Status errorStatus(grpc::StatusCode code, const std::string& message,
                         const tinycad::v1::ErrorDetail& detail);

/**
 * A geometry error as its status: KERNEL_INVALID_INPUT → INVALID_ARGUMENT,
 * KERNEL_OPERATION_FAILED → FAILED_PRECONDITION, KERNEL_INTERNAL → INTERNAL. `path` names the
 * wrong field of the request when known.
 */
grpc::Status geometryStatus(const geometry::GeometryError& error, const std::string& path = {});

/** Called from a catch (...) around the body of an RPC: KERNEL_INTERNAL with the exception text. */
grpc::Status internalStatusOfCurrentException();

}  // namespace tinycad::service
