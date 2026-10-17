#pragma once

// The read model of a session as domain data (spec 14 "Read model a sítě", decisions N53, N154):
// what RuntimeDocument returns after every change and for GetReadModel. The rpc layer converts it
// into the tinycad.v1 messages (rpc::readModelToProto); the session layer knows no protobuf.
//
// A ReadModel holds only shared immutable data (StudioPtr, a copy of RegenResult with its
// StatePtr, BodyPtr, shared_ptr<const MeshData>), never a reference into the runtime document, so
// it stays valid after the document lock is released and the conversion runs outside the lock.
// Everything that needs the kernel or the Regenerator (the content version of a body, its mesh)
// is computed while building it, under the lock; the conversion never calls the kernel.

#include <cstdint>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/kernel/types.hpp"
#include "tinycad/regen/regenerator.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::session {

/** What the client asks of a read model (ReadModelOptions of every request). */
struct ReadModelOptions {
  /** content_version of the meshes the client already has (they come without a mesh). */
  std::set<std::string> knownMeshes;
  /** The feature of an open dialog whose input the read model carries (ADR 0025). */
  std::optional<document::FeatureId> inputOf;
};

/** A body of a state with its content version and its mesh. */
struct BodyView {
  regen::BodyPtr body;
  /** Regenerator::contentVersion (N43). */
  std::string contentVersion;
  /** nullptr when the client listed contentVersion in ReadModelOptions::knownMeshes. */
  std::shared_ptr<const kernel::MeshData> mesh;
};

/** The read model from the point of view of the session that asks. */
struct SessionView {
  /** The caller holds the edit lease. */
  bool writable = false;
  bool canUndo = false;
  bool canRedo = false;
  /** The label of the open transaction; nullopt = no open transaction. */
  std::optional<std::string> transactionLabel;
};

/** The whole read model of one session; only shared immutable data, valid without the lock. */
struct ReadModel {
  document::DocumentMeta meta;
  /** Features, rollback index and body metadata. */
  document::StudioPtr studio;
  /** seq of the last log entry. */
  std::int64_t lastSeq = 0;
  /** The change counter of the runtime document (N55). */
  std::uint64_t generation = 0;
  /**
   * Statuses, final state, anchors, input and duration of the regeneration. `regen.input` is set
   * only when ReadModelOptions::inputOf named that feature (so the rpc layer writes it as it is).
   */
  regen::RegenResult regen;
  /** The bodies of regen.finalState, in state order. */
  std::vector<BodyView> bodies;
  /** The bodies of regen.input's state, in state order; empty without input. */
  std::vector<BodyView> inputBodies;
  SessionView session;
};

/** The answer to a change: the log entry (when there is one) and the read model after it. */
struct ChangeResult {
  /** LogEntry JSON of spec 04 (storage::Change::entry); nullopt = no entry. */
  std::optional<core::Json> entry;
  ReadModel readModel;
};

/** GetHistory: the log entries from a seq on and the undo and redo stacks. */
struct HistoryView {
  /** LogEntry JSON of spec 04 with seq >= fromSeq, in order. */
  std::vector<core::Json> entries;
  std::vector<std::int64_t> undoStack;
  std::vector<std::int64_t> redoStack;
};

}  // namespace tinycad::session
