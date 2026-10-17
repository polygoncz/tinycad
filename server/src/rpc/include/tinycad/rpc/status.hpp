#pragma once

// Errors of the RPCs as google.rpc.Status with one tinycad.v1.ErrorDetail (errors.proto, spec 14
// "Chyby"): the gRPC code says what the client may do, ErrorDetail.reason which domain error it
// is. The serialized google.rpc.Status travels in the grpc-status-details-bin trailer.
//
// The domain knows no gRPC (decision N154): SessionService and DocumentService turn a
// session::SessionError into a status here (toStatus), GeometryService a geometry::GeometryError
// (geometryStatus). A programmer error (TINYCAD_ASSERT, an exception out of a handler or a
// builder) is caught by the service around the body of each RPC and reported as INTERNAL.

#include <grpcpp/support/status.h>

#include <string>

#include "tinycad/geometry/geometry.hpp"
#include "tinycad/session/session_error.hpp"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::rpc {

/**
 * The status of a session error: code by the one table of errors.proto (see session::ErrorReason),
 * message, and exactly one detail ErrorDetail { reason, path, issues }.
 */
grpc::Status toStatus(const session::SessionError& error);

/** Called from a catch (...) around the body of a session RPC: INTERNAL with the exception text. */
grpc::Status internalStatusOfCurrentException();

/** A failed RPC: the code, the technical message and one ErrorDetail in the status details. */
grpc::Status errorStatus(grpc::StatusCode code, const std::string& message,
                         const tinycad::v1::ErrorDetail& detail);

/**
 * A geometry error as its status: KERNEL_INVALID_INPUT → INVALID_ARGUMENT,
 * KERNEL_OPERATION_FAILED → FAILED_PRECONDITION, KERNEL_INTERNAL → INTERNAL. `path` names the
 * wrong field of the request when known.
 */
grpc::Status geometryStatus(const geometry::GeometryError& error, const std::string& path = {});

/**
 * Called from a catch (...) around the body of a GeometryService RPC: KERNEL_INTERNAL with the
 * exception text (a session RPC reports ERROR_REASON_UNSPECIFIED instead).
 */
grpc::Status internalGeometryStatusOfCurrentException();

}  // namespace tinycad::rpc
