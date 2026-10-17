#include "tinycad/session/runtime_document.hpp"

#include <algorithm>
#include <cstddef>
#include <mutex>
#include <utility>
#include <vector>

#include "runtime_support.hpp"
#include "tinycad/features/sketch_solve.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/operation.hpp"
#include "tinycad/ops/undo.hpp"
#include "tinycad/session/read_model_builder.hpp"
#include "tinycad/storage/persistent_document.hpp"

namespace tinycad::session {

namespace {

SessionError readOnly() {
  return {ErrorReason::ReadOnly, {}, {}, "another session holds the edit lease of the document"};
}

SessionError operationIdReused(const storage::OperationKey& key) {
  return {ErrorReason::OperationIdReused, "operation_id", {},
          "operation id '" + key.id + "' was used for another request"};
}

/**
 * Forwards RegenObserver::featureDone as regen_progress events (spec 14 "Události"), but only
 * during the regeneration right after a change and only for the features that run builds anew
 * (N118): a regeneration runs for every read model, and reporting the features taken from the
 * cache would spin the ring of 256 events and push readers into `resync`. The event carries the
 * change counter of the runtime document (N55), not the run count of the Regenerator.
 *
 * Which features a run builds anew is the Regenerator's cache rule (spec 07, cache step 1): the
 * first position whose FeaturePtr differs from the cached one, up to the rollback bar. The
 * Regenerator does not tell, so this class mirrors the feature pointers of its cache: before a
 * run expect() computes the rebuilt features, after a successful run ran() records what the cache
 * holds now (a run that throws leaves the Regenerator's cache, and so the mirror, unchanged).
 */
class ProgressEvents final : public regen::RegenObserver {
 public:
  ProgressEvents(EventRing& events, const std::uint64_t& generation)
      : events_(events), generation_(generation) {}

  /** A change happened: the next run reports its rebuilt features. */
  void changeHappened() { afterChange_ = true; }

  /** Before a run of `studio`. */
  void expect(const document::PartStudioData& studio) {
    rebuilt_.clear();
    if (!afterChange_) return;
    afterChange_ = false;
    const std::size_t rollback = rollbackOf(studio);
    for (std::size_t i = firstChanged(studio); i < rollback; ++i) {
      rebuilt_.push_back(studio.features[i]->id);
    }
  }

  /** After a successful run of `studio`: the cache keeps positions 0..max(k, rollback)-1. */
  void ran(const document::PartStudioData& studio) {
    const std::size_t kept = std::max(firstChanged(studio), rollbackOf(studio));
    cached_.assign(studio.features.begin(),
                   studio.features.begin() + static_cast<std::ptrdiff_t>(kept));
    rebuilt_.clear();
  }

  void featureDone(int /*runGeneration*/, const document::FeatureId& feature,
                   const regen::FeatureStatus& status) override {
    if (std::ranges::find(rebuilt_, feature) == rebuilt_.end()) return;
    SessionEvent event;
    event.kind = SessionEvent::Kind::RegenProgress;
    event.generation = generation_;
    event.featureId = feature;
    event.status = status;
    events_.append(std::move(event));
  }

 private:
  static std::size_t rollbackOf(const document::PartStudioData& studio) {
    const int count = static_cast<int>(studio.features.size());
    return static_cast<std::size_t>(std::max(0, std::min(studio.rollbackIndex, count)));
  }

  /** Cache step 1: the first position whose feature is not the cached pointer. */
  [[nodiscard]] std::size_t firstChanged(const document::PartStudioData& studio) const {
    std::size_t k = 0;
    while (k < studio.features.size() && k < cached_.size() &&
           studio.features[k] == cached_[k]) {
      ++k;
    }
    return k;
  }

  EventRing& events_;
  const std::uint64_t& generation_;
  bool afterChange_ = false;
  std::vector<document::FeaturePtr> cached_;
  std::vector<document::FeatureId> rebuilt_;
};

}  // namespace

/**
 * Everything the runtime document owns. Members are destroyed in reverse order: the solver and the
 * read model parts first, then the Regenerator (it releases its handles) before the kernel.
 */
struct RuntimeDocument::Impl {
  Impl(document::DocumentId documentId, const Dependencies& dependencies,
       std::unique_ptr<storage::PersistentDocument> persistent)
      : deps(dependencies),
        id(std::move(documentId)),
        doc(std::move(persistent)),
        events(dependencies.eventCapacity),
        progress(events, generation),
        kernel(dependencies.newKernel()),
        regenerator(std::make_unique<regen::Regenerator>(*kernel, dependencies.builders,
                                                         dependencies.schemas,
                                                         dependencies.steady)),
        meshes(std::make_unique<MeshCache>(*kernel)),
        readModels(std::make_unique<ReadModelBuilder>(*meshes)),
        solver(dependencies.newSolver()),
        sketches(std::make_unique<features::SketchOperationSolver>(*solver)) {
    regenerator->setObserver(&progress);
  }

  Dependencies deps;
  document::DocumentId id;

  /** The document lock (N54): held by every public method for its whole duration. */
  std::mutex mutex;
  /**
   * The edit lease has its own small lock, taken after the document lock and never held while
   * waiting: the SessionManager asks for the lease under its own lock, and it must never wait
   * there for a running change (spec 14 "Vlákna a zámky serveru", N106).
   */
  mutable std::mutex leaseMutex;
  std::optional<SessionId> lease;

  std::unique_ptr<storage::PersistentDocument> doc;
  /** Label of the open transaction; meaningful only while doc->inTransaction(). */
  std::string transactionLabel;
  /** The change counter (N55). */
  std::uint64_t generation = 0;
  EventRing events;
  ProgressEvents progress;

  std::unique_ptr<kernel::GeometryKernel> kernel;
  std::unique_ptr<regen::Regenerator> regenerator;
  std::unique_ptr<MeshCache> meshes;
  std::unique_ptr<ReadModelBuilder> readModels;
  std::unique_ptr<sketch::ConstraintSolver> solver;
  std::unique_ptr<features::SketchOperationSolver> sketches;

  // --- the steps of a change; all called under `mutex` ---------------------------------------

  [[nodiscard]] bool holdsLease(const SessionId& session) const {
    const std::lock_guard lock(leaseMutex);
    return lease == session;
  }

  /** Step 2 of a durable call (N107): the stored entry, nullopt for a new key, or the error. */
  SessionResult<std::optional<storage::Change>> stored(const storage::OperationKey& key) {
    auto found = doc->lookup(key);
    if (!found) return core::fail(fromChangeError(found.error()));
    return std::move(*found);
  }

  /** Step 3 (N47): the operation with every sketch it writes solved by the server. */
  SessionResult<core::Json> solved(const core::Json& op) {
    auto result = sketches->solve(op, doc->document());
    if (!result) return core::fail(fromSketchNotSolved(result.error()));
    return std::move(*result);
  }

  /**
   * A failed PersistentDocument call. Storage of a durable call that found the document intact
   * means it was reloaded from the file (N35): that is a change of its own (generation + 1 and
   * `changed` without a session, so every session refreshes), and the open transaction is gone.
   */
  SessionError failed(const storage::ChangeError& error, bool wasBroken) {
    if (error.code == storage::ChangeErrorCode::Storage && !wasBroken) changed("");
    return fromChangeError(error);
  }

  /** Step 5: generation + 1 and the `changed` event. */
  void changed(const std::string& bySession) {
    ++generation;
    progress.changeHappened();
    SessionEvent event;
    event.kind = SessionEvent::Kind::Changed;
    event.generation = generation;
    event.lastSeq = doc->log().lastSeq();
    event.bySessionId = bySession;
    events.append(std::move(event));
  }

  [[nodiscard]] std::optional<std::string> openTransaction() const {
    if (!doc->inTransaction()) return std::nullopt;
    return transactionLabel;
  }

  /** Every run of the Regenerator goes through here, so the progress mirror stays in step. */
  regen::RegenResult regenerate(const document::PartStudioData& studio,
                                const regen::RunOptions& run = {}) {
    progress.expect(studio);
    regen::RegenResult result = regenerator->run(studio, run);
    progress.ran(studio);
    return result;
  }

  /** Step 6: regeneration with the input_of of the request, then the read model of the caller. */
  SessionResult<ReadModel> readModel(const Caller& caller, const ReadModelOptions& options) {
    regen::RunOptions run;
    run.inputOf = options.inputOf;
    const document::StudioPtr studio = doc->document().studio();
    const regen::RegenResult result = regenerate(*studio, run);
    meshes->retain(ReadModelBuilder::liveVersions(result, *regenerator));
    const ReadModelInput input{doc->document(),     doc->log().lastSeq(),
                               generation,          result,
                               *regenerator,        holdsLease(caller.session),
                               doc->canUndo(),      doc->canRedo(),
                               openTransaction(),   caller.quality};
    return readModels->build(input, options);
  }

  /** The ChangeResult: the entry (when there is one) and the read model of the caller. */
  SessionResult<ChangeResult> answer(const Caller& caller, const std::optional<core::Json>& entry,
                                     const ReadModelOptions& options) {
    auto model = readModel(caller, options);
    if (!model) return core::fail(std::move(model.error()));
    return ChangeResult{entry, std::move(*model)};
  }

  /**
   * Steps 1 and 2 of a durable call (dispatch, commit, undo, redo): the lease, then the stored
   * entry. Returns the finished call (the answer to a repeated request, or the error) or nullopt
   * when the request is new and the change goes on.
   */
  std::optional<SessionResult<ChangeResult>> repeatedDurable(const Caller& caller,
                                                             const storage::OperationKey& key,
                                                             const ReadModelOptions& options) {
    if (!holdsLease(caller.session)) return core::fail(readOnly());
    auto found = stored(key);
    if (!found) return core::fail(std::move(found.error()));
    if (*found) return answer(caller, (*found)->entry, options);
    return std::nullopt;
  }

  /** Steps 5 and 6 of a durable call after the PersistentDocument call. */
  SessionResult<ChangeResult> finishDurable(
      const Caller& caller, core::Result<storage::Change, storage::ChangeError> change,
      bool wasBroken, const ReadModelOptions& options) {
    if (!change) return core::fail(failed(change.error(), wasBroken));
    if (!change->repeated) changed(caller.session.str());
    return answer(caller, change->entry, options);
  }

  /**
   * Steps 1 and 2 of a transaction step (N58): the lease, then the session's memory of recent
   * steps. Returns the finished call (the CURRENT read model for a repeat, or the error) or
   * nullopt when the step is new.
   */
  std::optional<SessionResult<ChangeResult>> repeatedStep(const Caller& caller,
                                                          const StepKey& step,
                                                          const ReadModelOptions& options) {
    if (!holdsLease(caller.session)) return core::fail(readOnly());
    switch (step.recent.lookup(step.key)) {
      case RecentResponses::Lookup::New:
        return std::nullopt;
      case RecentResponses::Lookup::Repeated:
        return answer(caller, std::nullopt, options);
      case RecentResponses::Lookup::Reused:
        return core::fail(operationIdReused(step.key));
    }
    return std::nullopt;
  }

  /** Steps 5 and 6 of a successful transaction step. */
  SessionResult<ChangeResult> finishStep(const Caller& caller, const StepKey& step,
                                         const ReadModelOptions& options) {
    step.recent.remember(step.key);
    changed(caller.session.str());
    return answer(caller, std::nullopt, options);
  }
};

RuntimeDocument::RuntimeDocument(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

RuntimeDocument::~RuntimeDocument() { impl_->events.close(); }

SessionResult<std::unique_ptr<RuntimeDocument>> RuntimeDocument::open(
    const document::DocumentId& id, const Dependencies& deps) {
  auto file = deps.catalog.open(id);
  if (!file) {
    const ErrorReason reason = file.error().code == storage::StoreErrorCode::NotFound
                                   ? ErrorReason::DocumentNotFound
                                   : ErrorReason::Storage;
    return core::fail(SessionError{reason, "document_id", {}, file.error().message});
  }
  const storage::PersistentDocument::Dependencies documentDeps{deps.schemas, deps.handlers,
                                                               deps.now, deps.verify};
  auto doc = storage::PersistentDocument::open(std::move(*file), documentDeps);
  if (!doc) return core::fail(fromLoadError(doc.error()));

  auto impl = std::make_unique<Impl>(id, deps, std::move(*doc));
  // The first regeneration: a broken builder shows as a feature status, not as a failed open.
  (void)impl->regenerate(*impl->doc->document().studio());
  // The constructor is private: no make_unique.
  return std::unique_ptr<RuntimeDocument>(new RuntimeDocument(std::move(impl)));
}

const document::DocumentId& RuntimeDocument::id() const { return impl_->id; }

// --- edit lease ---------------------------------------------------------------------------

bool RuntimeDocument::acquireLease(const SessionId& session) {
  const std::lock_guard lock(impl_->leaseMutex);
  if (!impl_->lease) impl_->lease = session;
  return impl_->lease == session;
}

void RuntimeDocument::releaseLease(const SessionId& session) {
  const std::lock_guard lock(impl_->mutex);
  if (!impl_->holdsLease(session)) return;
  if (impl_->doc->inTransaction() && impl_->doc->abort()) impl_->changed(session.str());
  const std::lock_guard leaseLock(impl_->leaseMutex);
  impl_->lease.reset();
}

std::optional<SessionId> RuntimeDocument::leaseHolder() const {
  const std::lock_guard lock(impl_->leaseMutex);
  return impl_->lease;
}

// --- durable changes ----------------------------------------------------------------------
//
// The lease and the stored entry come first, so a repeated request is never solved again (N107);
// the sketch is solved only for a new one.

SessionResult<ChangeResult> RuntimeDocument::dispatch(const Caller& caller, const core::Json& op,
                                                      const std::string& label,
                                                      const storage::OperationKey& key,
                                                      const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedDurable(caller, key, options)) return *done;
  auto solved = impl_->solved(op);
  if (!solved) return core::fail(std::move(solved.error()));
  const bool wasBroken = impl_->doc->broken();
  return impl_->finishDurable(caller, impl_->doc->dispatch(*solved, label, key), wasBroken,
                              options);
}

SessionResult<ChangeResult> RuntimeDocument::undo(const Caller& caller,
                                                  const storage::OperationKey& key,
                                                  const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedDurable(caller, key, options)) return *done;
  const bool wasBroken = impl_->doc->broken();
  return impl_->finishDurable(caller, impl_->doc->undo(key), wasBroken, options);
}

SessionResult<ChangeResult> RuntimeDocument::redo(const Caller& caller,
                                                  const storage::OperationKey& key,
                                                  const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedDurable(caller, key, options)) return *done;
  const bool wasBroken = impl_->doc->broken();
  return impl_->finishDurable(caller, impl_->doc->redo(key), wasBroken, options);
}

SessionResult<ChangeResult> RuntimeDocument::commit(const Caller& caller, const StepKey& step,
                                                    const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedDurable(caller, step.key, options)) return *done;
  // An empty commit left no entry to find; the session remembers its key instead (N107).
  if (auto done = impl_->repeatedStep(caller, step, options)) return *done;
  const bool wasBroken = impl_->doc->broken();
  auto change = impl_->doc->commit(step.key);
  if (change && !change->entry) step.recent.remember(step.key);
  return impl_->finishDurable(caller, std::move(change), wasBroken, options);
}

// --- transaction steps (in-memory idempotence, N58) ---------------------------------------

SessionResult<ChangeResult> RuntimeDocument::begin(const Caller& caller, const std::string& label,
                                                   const StepKey& step,
                                                   const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedStep(caller, step, options)) return *done;
  auto begun = impl_->doc->begin(label);
  if (!begun) return core::fail(fromChangeError(begun.error()));
  impl_->transactionLabel = label;
  return impl_->finishStep(caller, step, options);
}

SessionResult<ChangeResult> RuntimeDocument::apply(const Caller& caller, const core::Json& op,
                                                   const StepKey& step,
                                                   const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedStep(caller, step, options)) return *done;
  auto solved = impl_->solved(op);
  if (!solved) return core::fail(std::move(solved.error()));
  auto applied = impl_->doc->apply(*solved);
  if (!applied) return core::fail(fromChangeError(applied.error()));
  return impl_->finishStep(caller, step, options);
}

SessionResult<ChangeResult> RuntimeDocument::applyTransient(const Caller& caller,
                                                            const core::Json& op,
                                                            const StepKey& step,
                                                            const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedStep(caller, step, options)) return *done;
  auto solved = impl_->solved(op);
  if (!solved) return core::fail(std::move(solved.error()));
  auto applied = impl_->doc->applyTransient(*solved);
  if (!applied) return core::fail(fromChangeError(applied.error()));
  return impl_->finishStep(caller, step, options);
}

SessionResult<ChangeResult> RuntimeDocument::abort(const Caller& caller, const StepKey& step,
                                                   const ReadModelOptions& options) {
  const std::lock_guard lock(impl_->mutex);
  if (auto done = impl_->repeatedStep(caller, step, options)) return *done;
  auto aborted = impl_->doc->abort();
  if (!aborted) return core::fail(fromChangeError(aborted.error()));
  return impl_->finishStep(caller, step, options);
}

// --- rename through DocumentService (N37) -------------------------------------------------

SessionResult<storage::DocumentSummary> RuntimeDocument::rename(const std::string& name,
                                                                const storage::OperationKey& key) {
  const std::lock_guard lock(impl_->mutex);
  const auto summary = [&] {
    const document::DocumentMeta& meta = impl_->doc->document().meta();
    return storage::DocumentSummary{meta.id, meta.name, meta.createdAt, impl_->deps.now()};
  };
  auto found = impl_->stored(key);
  if (!found) return core::fail(std::move(found.error()));
  if (*found) return summary();
  if (impl_->doc->inTransaction()) {
    return core::fail(SessionError{ErrorReason::DocumentOpen, {}, {},
                                   "the document has an open transaction"});
  }
  const std::string trimmed = trimDocumentName(name);
  if (trimmed.empty()) {
    return core::fail(SessionError{ErrorReason::InvalidOperation, "name", {}, "empty name"});
  }
  const core::Json op{{"type", "document.rename"},
                      {"v", ops::opVersion("document.rename")},
                      {"name", trimmed}};
  const bool wasBroken = impl_->doc->broken();
  auto change = impl_->doc->dispatch(op, "document.rename", key);
  if (!change) return core::fail(impl_->failed(change.error(), wasBroken));
  if (!change->repeated) impl_->changed("");
  return summary();
}

// --- reading ------------------------------------------------------------------------------

SessionResult<ReadModel> RuntimeDocument::readModel(const Caller& caller,
                                                    const ReadModelOptions& options,
                                                    std::uint64_t* eventSeq) {
  const std::lock_guard lock(impl_->mutex);
  auto built = impl_->readModel(caller, options);
  if (built && eventSeq != nullptr) *eventSeq = impl_->events.lastSeq();
  return built;
}

HistoryView RuntimeDocument::history(std::int64_t fromSeq) {
  const std::lock_guard lock(impl_->mutex);
  HistoryView out;
  const ops::OperationLog& log = impl_->doc->log();
  for (const ops::LogEntry& entry : log.entries(std::max<std::int64_t>(fromSeq, 1))) {
    out.entries.push_back(ops::logEntryJson(entry));
  }
  // The log in memory was checked when the document was loaded (N108), so it cannot be corrupt.
  const auto stacks = ops::rebuildUndoStacks(log.entries());
  TINYCAD_ASSERT(stacks.has_value(), "the undo targets of an open document are consistent");
  out.undoStack = stacks->undo;
  out.redoStack = stacks->redo;
  return out;
}

SessionResult<StepFile> RuntimeDocument::exportStep() {
  const std::lock_guard lock(impl_->mutex);
  const document::DocumentReader& doc = impl_->doc->document();
  const regen::RegenResult result = impl_->regenerate(*doc.studio());
  std::vector<kernel::ShapeHandle> shapes;
  for (const regen::BodyPtr& body : result.finalState->bodies()) {
    if (!doc.bodyMeta(body->bodyId()).hidden) shapes.push_back(body->shape());
  }
  auto content = impl_->kernel->exportStep(shapes);
  if (!content) {
    return core::fail(SessionError{ErrorReason::Internal, {}, {}, content.error().message});
  }
  return StepFile{std::move(*content), safeFileName(doc.meta().name) + ".step"};
}

EventRing& RuntimeDocument::events() { return impl_->events; }

}  // namespace tinycad::session
