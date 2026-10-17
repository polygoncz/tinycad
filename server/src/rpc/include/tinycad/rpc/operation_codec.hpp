#pragma once

// The wire format of operations and log entries ↔ the JSON of spec 04 (spec 14 "Pravidla tvaru
// kontraktu", Q101; moved here from M40 by decision N27). The wire format is not the storage
// format: the log in SQLite stays the JSON operation { type, v, ... } with `v` and upcast
// (ADR 0005), so every operation is converted here before it reaches the dispatcher and back when
// it leaves as a log entry.
//
// Conversion only, no validation of the content: a structurally complete message becomes the JSON
// operation and the op handlers of M40 validate it (INVALID_OPERATION with the handler's path).
// What only the wire can get wrong (an empty oneof, BODY_MATERIAL_UNSPECIFIED, a nested empty
// batch entry) is refused here with a path in proto field names, as errors.proto shows
// ('op.feature_set_params.params', 'op.batch.ops[2]').

#include "tinycad/core/json.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/session/session_error.hpp"
#include "tinycad/v1/operations.pb.h"
#include "tinycad/v1/session.pb.h"

namespace tinycad::session {

/**
 * tinycad.v1.Operation → the JSON operation of spec 04 with the CURRENT `v` of its type (the
 * version table of ops, M40). Field mapping 1:1 by name in camelCase (feature_id → featureId,
 * to_index → toIndex, type_version → typeVersion); params Struct → JSON object (numbers stay
 * doubles; whole numbers are written as integers by core::numberJson, so the JSON equals what
 * the TS client would have produced); BodySetColor without `color` → { color: null };
 * BodyMaterial enum → its JSON name ('plastic'…); Batch → { type: 'batch', ops: [...] }.
 * Errors: empty oneof (at any depth) → InvalidOperation 'op' / 'op.batch.ops[i]';
 * BODY_MATERIAL_UNSPECIFIED → InvalidOperation 'op.body_set_material.material'.
 */
SessionResult<core::Json> operationToJson(const tinycad::v1::Operation& op);

/**
 * The inverse, for the round-trip tests (spec 14 "Testy": every Operation ↔ JSON operation and
 * back) and for nothing else on the server. Precondition: `json` is a valid operation of the
 * current version (TINYCAD_ASSERT otherwise).
 */
void operationFromJson(const core::Json& json, tinycad::v1::Operation* out);

/** A feature of the document as it travels in DocumentView and in FeatureAdd. */
void featureToProto(const document::FeatureInstance& feature, tinycad::v1::FeatureInstance* out);

/**
 * A LogEntry JSON of spec 04 (as PersistentDocument returns it) → LogEntryView: seq, kind,
 * target (0 for 'do'), label, time (ms → Timestamp), op_type = entry.op.type ('batch' for a
 * batch). The operation and its inverse do not travel (the history panel needs neither).
 */
void logEntryView(const core::Json& entry, tinycad::v1::LogEntryView* out);

}  // namespace tinycad::session
