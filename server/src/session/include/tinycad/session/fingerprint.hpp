#pragma once

// The fingerprint of a request for idempotence (spec 14 "Idempotence", decision N57): the same
// operation_id with another fingerprint is OPERATION_ID_REUSED.
//
// fingerprint = lowercase hex SHA-256 of the CANONICAL JSON of the request (N107, refining N57):
// a copy of the request with `session_id`, `operation_id` and `read` cleared, written as an object
// with the proto field names as keys, every tinycad.v1.Operation field converted to the JSON
// operation of spec 04 (operationToJson), keys sorted at every level, no white space. Not the
// protobuf bytes: deterministic protobuf serialization is guaranteed only within one build, and
// the fingerprint is stored in SQLite for good.
//
// So a retry that lists other known_meshes or another input_of is the same request, and a retry
// from a NEW session after SESSION_NOT_FOUND (server restart) still matches the stored entry. It
// is computed from the request of the client, never from the operation after the server re-solved
// a sketch (N47): the solution may differ in the last bits between runs and must not turn a retry
// into OPERATION_ID_REUSED.
//
// The same string goes to SQLite as storage::OperationKey::fingerprint (durable requests) and to
// RecentResponses (transaction steps, in memory).

#include <string>
#include <string_view>

#include <google/protobuf/message.h>

#include "tinycad/storage/store.hpp"

namespace tinycad::session {

/** Hex SHA-256 of the canonical JSON of the request without session_id, operation_id and read. */
std::string requestFingerprint(const google::protobuf::Message& request);

/** { request.operation_id, requestFingerprint(request) }; the request must have operation_id. */
storage::OperationKey operationKey(const google::protobuf::Message& request);

/** Hex SHA-256 of bytes (ImportDocument content; the key 'import:<sha256>' of N38 and N71). */
std::string sha256Hex(std::string_view bytes);

}  // namespace tinycad::session
