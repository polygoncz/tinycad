#pragma once

// The read model (spec 14 "Read model a sítě", Q099, Q100) as domain data (read_model.hpp,
// decisions N53, N154): the builder collects what one read model needs from the runtime document
// and does under the document lock only what needs the kernel or the Regenerator. The rpc layer
// converts the result into the tinycad.v1 messages after the lock is released.
//
// Meshes: every BodyView carries its content version (N43, Regenerator::contentVersion) and gets
// its mesh only when the client did not list that version in ReadModelOptions::knownMeshes.
// Tessellation is done once per (content version, quality) and kept in the MeshCache of the
// runtime document (N60), so several sessions and every later read model reuse it.
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
#include "tinycad/session/read_model.hpp"
#include "tinycad/session/session_error.hpp"

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
  /** seq of the last log entry. */
  std::int64_t lastSeq = 0;
  /** The change counter of the runtime document (N55). */
  std::uint64_t generation = 0;
  /** The result of Regenerator::run for this studio and ReadModelOptions::inputOf. */
  const regen::RegenResult& regen;
  /** Regenerator::contentVersion. */
  const regen::Regenerator& versions;
  /** SessionView: from the point of view of the session that asks. */
  bool writable = false;
  bool canUndo = false;
  bool canRedo = false;
  /** The label of the open transaction; nullopt = no open transaction in the document. */
  std::optional<std::string> transactionLabel;
  /** The tessellation of this session (OpenSessionRequest.mesh_quality or the server default). */
  kernel::MeshQuality quality;
};

class ReadModelBuilder {
 public:
  /** `meshes` must outlive the builder. */
  explicit ReadModelBuilder(MeshCache& meshes);

  /**
   * The read model of the input:
   * - meta and studio of the document, lastSeq, generation;
   * - regen = a copy of input.regen, its `input` kept only when options.inputOf names that
   *   feature (ADR 0025);
   * - bodies = the bodies of the final state in state order, inputBodies = those of the input
   *   state (empty without input): each with its content version and its mesh from the
   *   MeshCache, nullptr when the version is in options.knownMeshes;
   * - session: writable, canUndo, canRedo, transactionLabel.
   * A mesh that fails to tessellate → SessionError Internal.
   */
  SessionResult<ReadModel> build(const ReadModelInput& input, const ReadModelOptions& options);

  /**
   * The content_versions of the bodies of result.finalState and of result.input, for
   * MeshCache::retain after a regeneration (a version another session still needs for its own
   * inputOf is simply tessellated again on its next read model).
   */
  static std::set<std::string> liveVersions(const regen::RegenResult& result,
                                            const regen::Regenerator& versions);

 private:
  MeshCache& meshes_;
};

}  // namespace tinycad::session
