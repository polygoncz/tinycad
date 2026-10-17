#pragma once

// The runtime document (spec 14 "Sezení"): a document open in the core at most once, shared by
// every session over it. It owns everything that lives as long as the document is open:
//
//   PersistentDocument (M41: document, log, dispatcher, undo, SQLite file)
//   one GeometryKernel, one Regenerator over it, one MeshCache   (N13: one caller per kernel)
//   one ConstraintSolver behind SketchOperationSolver            (N47: re-solve before dispatch)
//   the edit lease (Q102), the change counter (N55) and the EventRing (WatchSession)
//
// Threads (decision N54): every public method takes the document mutex for its whole duration,
// so changes, regenerations and read models of one document run one after another and the kernel
// sees one caller. The EventRing is the exception: it has its own lock, WatchSession waits on it
// without the document mutex. Lock order: SessionManager → RuntimeDocument → EventRing.
//
// One change call = (1) lease check, (2) idempotence check, (3) sketch re-solve (N47),
// (4) PersistentDocument call, (5) generation + 1 and a `changed` event, (6) regeneration and the
// read model of the caller into the ChangeResult. A repeated request skips 3–5 and answers with
// the stored entry (durable) or none (transaction steps) and the CURRENT read model (spec 14).

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>

#include "tinycad/core/json.hpp"
#include "tinycad/core/strong_id.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/regen/regenerator.hpp"
#include "tinycad/session/event_ring.hpp"
#include "tinycad/session/recent_responses.hpp"
#include "tinycad/session/session_error.hpp"
#include "tinycad/sketch/solver.hpp"
#include "tinycad/storage/store.hpp"
#include "tinycad/v1/read_model.pb.h"
#include "tinycad/v1/session.pb.h"

namespace tinycad::ops {
class OpHandlerRegistry;
}  // namespace tinycad::ops

namespace tinycad::session {

struct SessionIdTag;
/** A UUID v4 minted by the SessionManager (sequential in tests). */
using SessionId = core::StrongId<SessionIdTag>;

/** Who calls: the session and its tessellation quality (fixed for the session, spec 14). */
struct Caller {
  SessionId session;
  kernel::MeshQuality quality;
};

/** A transaction step's idempotence (N58): the caller's in-memory cache and the request key. */
struct StepKey {
  RecentResponses& recent;
  storage::OperationKey key;
};

struct StepFile {
  /** The STEP text (ISO 10303-21) of the visible bodies of the final state. */
  std::string content;
  /** '<document name>.step', characters unsafe in file names replaced by '_' (as exportFile). */
  std::string fileName;
};

class RuntimeDocument {
 public:
  struct Dependencies {
    storage::DocumentCatalog& catalog;
    /** The one schema registry of the server (also the handlers' and the regeneration's). */
    const document::FeatureSchemaRegistryReader& schemas;
    const ops::OpHandlerRegistry& handlers;
    const regen::FeatureBuilderRegistryReader& builders;
    /** ms since the epoch: LogEntry::time. */
    storage::WallClock now;
    /** Monotonic ms: RegenResult::durationMs. */
    regen::Regenerator::Clock steady;
    /** A new kernel for this document (OcctKernel; tests may decorate it, N45). */
    std::function<std::unique_ptr<kernel::GeometryKernel>()> newKernel;
    /** A new solver for SketchOperationSolver (PlanegcsSolver). */
    std::function<std::unique_ptr<sketch::ConstraintSolver>()> newSolver;
    /** spec 14: 256. */
    std::size_t eventCapacity = 256;
    /** PersistentDocument verify (spec 05); tests: true. */
    bool verify = false;
  };

  /**
   * Loads the document (catalog.open + PersistentDocument::open), creates its kernel, Regenerator
   * and solver and runs the first regeneration (so a broken builder shows as a status, not as a
   * failed open). Errors: missing id → DocumentNotFound; a stored document that does not load →
   * fromLoadError (InvalidDocument or Storage). `deps` must outlive the document.
   */
  static SessionResult<std::unique_ptr<RuntimeDocument>> open(const document::DocumentId& id,
                                                              const Dependencies& deps);

  /** Closes the EventRing (wakes every WatchSession), then releases Regenerator before kernel. */
  ~RuntimeDocument();
  RuntimeDocument(const RuntimeDocument&) = delete;
  RuntimeDocument& operator=(const RuntimeDocument&) = delete;

  [[nodiscard]] const document::DocumentId& id() const;

  // --- edit lease (Q102) --------------------------------------------------------------------

  /** True when the lease was free (the session takes it) or the session already holds it. */
  bool acquireLease(const SessionId& session);
  /**
   * The session leaves (CloseSession, idle timeout): when it holds the lease, an open transaction
   * ends as Abort (generation + 1, `changed` event) and the lease becomes free. Anyone else:
   * nothing. The lease is never handed to a waiting read-only session (Q102: it stays read-only
   * until it opens again).
   */
  void releaseLease(const SessionId& session);
  [[nodiscard]] std::optional<SessionId> leaseHolder() const;

  // --- changes (spec 14 "Změny dokumentu"); a caller without the lease → ReadOnly -----------
  //
  // Each fills `out` with the log entry (LogEntryView; unset when none) and the read model of the
  // caller after the change (ReadModelOptions of the request). Errors leave the document, the
  // transaction, the log, the generation and the events unchanged (except Storage, N35: the
  // document was reloaded from the file, generation + 1 and `changed`, an open transaction is
  // gone – a retried Commit then answers NoTransaction).

  /** OperationDispatcher::dispatch; label '' = the op type. Durable idempotence (N34). */
  SessionResult<void> dispatch(const Caller& caller, const core::Json& op, const std::string& label,
                               const storage::OperationKey& key,
                               const tinycad::v1::ReadModelOptions& options,
                               tinycad::v1::ChangeResult* out);
  SessionResult<void> begin(const Caller& caller, const std::string& label, const StepKey& step,
                            const tinycad::v1::ReadModelOptions& options,
                            tinycad::v1::ChangeResult* out);
  SessionResult<void> apply(const Caller& caller, const core::Json& op, const StepKey& step,
                            const tinycad::v1::ReadModelOptions& options,
                            tinycad::v1::ChangeResult* out);
  SessionResult<void> applyTransient(const Caller& caller, const core::Json& op,
                                     const StepKey& step,
                                     const tinycad::v1::ReadModelOptions& options,
                                     tinycad::v1::ChangeResult* out);
  /**
   * An empty transaction: success without entry (spec 04). Durable idempotence for a written
   * entry; an empty commit writes nothing, so its key is remembered in `step.recent` and a retry
   * succeeds again instead of NoTransaction (N107).
   */
  SessionResult<void> commit(const Caller& caller, const StepKey& step,
                             const tinycad::v1::ReadModelOptions& options,
                             tinycad::v1::ChangeResult* out);
  SessionResult<void> abort(const Caller& caller, const StepKey& step,
                            const tinycad::v1::ReadModelOptions& options,
                            tinycad::v1::ChangeResult* out);
  SessionResult<void> undo(const Caller& caller, const storage::OperationKey& key,
                           const tinycad::v1::ReadModelOptions& options,
                           tinycad::v1::ChangeResult* out);
  SessionResult<void> redo(const Caller& caller, const storage::OperationKey& key,
                           const tinycad::v1::ReadModelOptions& options,
                           tinycad::v1::ChangeResult* out);

  /**
   * RenameDocument of DocumentService for an OPEN document (N37): document.rename dispatched
   * without a lease (the service is a second writer, serialized by the document mutex, so the
   * seq never races). A transaction open in the document → DocumentOpen; an empty trimmed name →
   * InvalidOperation 'name'. Emits `changed` with an empty by_session_id. Returns the summary
   * after the rename (id, the new name, createdAt, updatedAt = now) for RenameDocumentResponse.
   */
  SessionResult<storage::DocumentSummary> rename(const std::string& name,
                                                 const storage::OperationKey& key);

  // --- reading --------------------------------------------------------------------------------

  /**
   * The read model for a session (writable = the caller holds the lease). With `eventSeq` also
   * events().lastSeq() at the same moment (OpenSessionResponse.event_seq: WatchSession after it
   * misses no change made after this read model).
   */
  SessionResult<void> readModel(const Caller& caller, const tinycad::v1::ReadModelOptions& options,
                                tinycad::v1::ReadModel* out, std::uint64_t* eventSeq = nullptr);
  /** GetHistory: LogEntryViews with seq >= fromSeq (1 = all) and the undo and redo stacks. */
  void history(std::int64_t fromSeq, tinycad::v1::GetHistoryResponse* out);
  /** ExportStep: GeometryKernel::exportStep of the bodies of the final state not hidden in body meta. */
  SessionResult<StepFile> exportStep();

  /** The events of this document; shared with WatchSession threads (own lock). */
  [[nodiscard]] EventRing& events();

 private:
  struct Impl;
  explicit RuntimeDocument(std::unique_ptr<Impl> impl);
  std::unique_ptr<Impl> impl_;
};

}  // namespace tinycad::session
