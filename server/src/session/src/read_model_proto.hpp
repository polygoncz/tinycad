#pragma once

// The domain results of the session layer → the tinycad.v1 messages (spec 14 "Read model a
// sítě", "Události", decisions N53, N154). Pure conversion of shared immutable data: it runs
// after RuntimeDocument returned, outside the document lock, and never calls the kernel.

#include "tinycad/session/read_model.hpp"
#include "tinycad/session/session_event.hpp"
#include "tinycad/v1/read_model.pb.h"
#include "tinycad/v1/session.pb.h"

namespace tinycad::session {

/**
 * Fills `out` (cleared first):
 * - document: id, name, last_seq, created_at_ms, features (featureToProto, in order),
 *   rollback_index, body_meta (every body with metadata; material UNSPECIFIED when default).
 * - regen: generation, statuses of every feature (Ok/Warning/Error/Suppressed/RolledBack,
 *   FeatureError code and issues), final state, input (when model.regen.input is set), anchors,
 *   duration_ms.
 * - StateView: bodies (model.bodies / model.inputBodies, in state order) with origin,
 *   last_modified_by, content_version, face_names[i] / edge_names[i] = NameTable primary name of
 *   face / edge i ('' = none), face_planes (index i of every planar face of NameTable::topology →
 *   its plane, N56), mesh only when BodyView::mesh is set; sketches (sketch_id, feature_id =
 *   owner, plane, entities followed by derivedEntities as one ListValue, regions from outlines
 *   in artifact order: name, outer, holes, area); planes; axes.
 * - session: writable, can_undo, can_redo, transaction.
 */
void readModelToProto(const ReadModel& model, tinycad::v1::ReadModel* out);

/** entry (LogEntryView, unset when none) and the read model. */
void changeResultToProto(const ChangeResult& change, tinycad::v1::ChangeResult* out);

/** LogEntryViews and the undo and redo stacks. */
void historyToProto(const HistoryView& history, tinycad::v1::GetHistoryResponse* out);

/** A stored event: seq and `changed` or `regen_progress` (Resync and Heartbeat are rpc only). */
void sessionEventToProto(const SessionEvent& event, tinycad::v1::SessionEvent* out);

/** known_meshes as a set, input_of '' → nullopt. */
ReadModelOptions readModelOptionsOf(const tinycad::v1::ReadModelOptions& options);

}  // namespace tinycad::session
