#pragma once

// The read model (spec 14 "Read model a sítě", Q099, Q100): the whole small snapshot the client
// gets after every change, written straight into the tinycad.v1 messages (decision N53: the read
// model IS the contract, no C++ mirror of it).
//
// Meshes are the exception: every BodyView carries content_version (N43, Regenerator::
// contentVersion) and gets its Mesh only when the client did not list that version in
// ReadModelOptions.known_meshes. Tessellation is done once per (content_version, quality) and
// kept in the MeshCache of the runtime document (N60), so several sessions and every later read
// model reuse it.
//
// Not thread-safe: the RuntimeDocument calls both classes under its lock (N54).

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>

#include "tinycad/document/document.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/regenerator.hpp"
#include "tinycad/regen/state.hpp"
#include "tinycad/session/session_error.hpp"
#include "tinycad/v1/read_model.pb.h"

namespace tinycad::session {

/** Meshes by "<content_version>@<linear>/<angular>" (N60). */
class MeshCache {
 public:
  /** `kernel` must outlive the cache (the kernel of the same runtime document). */
  explicit MeshCache(kernel::MeshOps& kernel);

  /**
   * The mesh of the body at the quality, tessellated on the first request. A kernel error is
   * returned (the read model then fails with Internal: a body the kernel built must tessellate).
   */
  kernel::KernelResult<std::shared_ptr<const kernel::MeshData>> mesh(
      const std::string& contentVersion, kernel::ShapeHandle shape, const kernel::MeshQuality& q);

  /** Drops every entry whose content_version is not in `live` (called after each regeneration). */
  void retain(const std::set<std::string>& live);

  [[nodiscard]] std::size_t size() const { return meshes_.size(); }

 private:
  kernel::MeshOps& kernel_;
  std::map<std::string, std::shared_ptr<const kernel::MeshData>> meshes_;
};

/** Everything one read model is built from; all references valid for the call only. */
struct ReadModelInput {
  const document::DocumentReader& document;
  /** seq of the last log entry (DocumentView.last_seq). */
  std::int64_t lastSeq = 0;
  /** RegenView.generation: the change counter of the runtime document (N55). */
  std::uint64_t generation = 0;
  /** The result of Regenerator::run for this studio and ReadModelOptions.input_of. */
  const regen::RegenResult& regen;
  /** Regenerator::contentVersion. */
  const regen::Regenerator& versions;
  /** SessionView: from the point of view of the session that asks. */
  bool writable = false;
  bool canUndo = false;
  bool canRedo = false;
  /** TransactionView.label; nullopt = no open transaction in the document. */
  std::optional<std::string> transactionLabel;
  /** The tessellation of this session (OpenSessionRequest.mesh_quality or the server default). */
  kernel::MeshQuality quality;
};

class ReadModelBuilder {
 public:
  /** `meshes` must outlive the builder. */
  explicit ReadModelBuilder(MeshCache& meshes);

  /**
   * Fills `out` (cleared first):
   * - document: id, name, last_seq, features (featureToProto, in order), rollback_index,
   *   body_meta (only bodies with metadata; material UNSPECIFIED when default).
   * - regen: generation, statuses of every feature (Ok/Warning/Error/Suppressed/RolledBack,
   *   FeatureError code and issues), final state, input (only when options.input_of names a
   *   feature with RegenResult::input; the same mesh rule), anchors (ok and warning features in
   *   front of the bar, RegenResult::anchors), duration_ms.
   * - StateView: bodies in state order with origin, last_modified_by, content_version,
   *   face_names[i] / edge_names[i] = NameTable primary name of face / edge i ('' = none),
   *   face_planes (N56: index i of every planar face of NameTable::topology → its plane, so a
   *   client without a kernel resolves a sketch on a face), mesh only when content_version is not
   *   in known_meshes; sketches (SketchArtifact: sketch_id, feature_id = owner, plane, entities =
   *   entities followed by derivedEntities as one ListValue, regions from outlines in artifact
   *   order: name, outer, holes, area); planes; axes.
   * - session: writable, can_undo, can_redo, transaction.
   * A mesh that fails to tessellate → SessionError Internal (and `out` is unspecified).
   */
  SessionResult<void> build(const ReadModelInput& input,
                            const tinycad::v1::ReadModelOptions& options,
                            tinycad::v1::ReadModel* out);

  /**
   * The content_versions of the bodies of result.finalState and of result.input, for
   * MeshCache::retain after a regeneration (a version another session still needs for its own
   * input_of is simply tessellated again on its next read model).
   */
  static std::set<std::string> liveVersions(const regen::RegenResult& result,
                                            const regen::Regenerator& versions);

 private:
  MeshCache& meshes_;
};

}  // namespace tinycad::session
