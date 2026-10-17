#include "tinycad/storage/persistent_document.hpp"

#include <iostream>
#include <utility>

#include "load.hpp"
#include "snapshot.hpp"
#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/transaction.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::storage {

namespace {

ChangeError changeError(ChangeErrorCode code, std::string message, std::string path = {}) {
  return ChangeError{code, std::move(path), std::move(message)};
}

/** A Change with an entry (emplace: nlohmann::json converts to std::optional ambiguously). */
Change changeOf(const core::Json& entry, bool repeated) {
  Change change;
  change.entry.emplace(entry);
  change.repeated = repeated;
  return change;
}

ChangeError invalidOperation(const ops::OperationLoadError& error) {
  return changeError(ChangeErrorCode::InvalidOperation, error.message, error.path);
}

ChangeError invalidOperation(const ops::DispatchError& error) {
  return changeError(ChangeErrorCode::InvalidOperation, error.message, error.path);
}

/**
 * The in-memory half of the document: document, log, dispatcher, undo and the open transaction.
 * Replaced as a whole when the state is reloaded from the file (the fallback of N155). Not movable: the parts
 * refer to each other. Members are destroyed in reverse order, so an open transaction is aborted
 * while the document still exists.
 */
struct Runtime {
  Runtime(std::unique_ptr<document::Document> loaded, std::vector<ops::LogEntry> entries,
          const ops::OpHandlerRegistry& handlers, const WallClock& now)
      : doc(std::move(loaded)),
        log(std::move(entries)),
        dispatcher(*doc, handlers, log, now),
        undo(dispatcher, log) {}
  Runtime(const Runtime&) = delete;
  Runtime& operator=(const Runtime&) = delete;

  std::unique_ptr<document::Document> doc;
  ops::OperationLog log;
  ops::OperationDispatcher dispatcher;
  ops::UndoManager undo;
  std::unique_ptr<ops::Transaction> transaction;
};

}  // namespace

/**
 * The document and the EntryWriter of its dispatcher (write-ahead, N155): the dispatcher hands
 * every entry to write() before it appends it to the log.
 */
struct PersistentDocument::Impl final : ops::EntryWriter {
  Impl(std::unique_ptr<DocumentFile> f, const Dependencies& d, std::unique_ptr<Runtime> r)
      : file(std::move(f)), deps(d) {
    use(std::move(r));
  }
  ~Impl() override = default;
  Impl(const Impl&) = delete;
  Impl& operator=(const Impl&) = delete;

  std::unique_ptr<DocumentFile> file;
  Dependencies deps;
  std::unique_ptr<Runtime> runtime;
  bool broken = false;
  /** The key of the durable call running now: the key write() stores with its entry. */
  std::optional<OperationKey> currentKey;

  /** Makes `r` the runtime and this its writer. */
  void use(std::unique_ptr<Runtime> r) {
    runtime = std::move(r);
    runtime->dispatcher.setWriter(this);
  }

  /** EntryWriter: the entry with the key of the running call, appended to the file. */
  core::Result<void, std::string> write(const ops::LogEntry& entry) override {
    TINYCAD_ASSERT(currentKey.has_value(), "PersistentDocument: a write outside a durable call");
    const StoredEntry stored{entry.seq, *currentKey, ops::logEntryJson(entry)};
    auto appended = file->appendEntries(std::span<const StoredEntry>(&stored, 1));
    if (!appended) return core::fail(std::move(appended.error().message));
    return {};
  }

  /** Loads the file into a new runtime. */
  static core::Result<std::unique_ptr<Runtime>, LoadError> loadRuntime(DocumentFile& file,
                                                                      const Dependencies& deps) {
    auto stored = file.load();
    if (!stored) {
      LoadError error;
      error.kind = LoadError::Kind::Storage;
      error.message = stored.error().message;
      return core::fail(std::move(error));
    }
    auto loaded = loadDocument(*stored, file.id(), deps.schemas, deps.handlers, deps.verify);
    if (!loaded) return core::fail(std::move(loaded.error()));
    return std::make_unique<Runtime>(std::move(loaded->doc), std::move(loaded->entries),
                                     deps.handlers, deps.now);
  }

  [[nodiscard]] bool inTransaction() const { return runtime->transaction != nullptr; }

  /** PersistentDocument::lookup. */
  core::Result<std::optional<Change>, ChangeError> lookup(const OperationKey& key) {
    if (broken) return core::fail(changeError(ChangeErrorCode::Storage, "the document is broken"));
    auto found = file->findEntry(key.id);
    if (!found) return core::fail(changeError(ChangeErrorCode::Storage, found.error().message));
    if (!*found) return std::optional<Change>();
    const StoredEntry& stored = **found;
    if (!stored.operation || stored.operation->fingerprint != key.fingerprint) {
      return core::fail(changeError(ChangeErrorCode::OperationIdReused,
                                    "operation id '" + key.id + "' was used for another request"));
    }
    return std::optional<Change>(changeOf(stored.entry, true));
  }

  /**
   * The first step of every durable call: the stored entry or the error of lookup; nullopt = the
   * key is new, go on.
   */
  std::optional<core::Result<Change, ChangeError>> repeatedOrRefused(const OperationKey& key) {
    auto found = lookup(key);
    if (!found) return core::fail(std::move(found.error()));
    if (!*found) return std::nullopt;
    return std::move(**found);
  }

  /**
   * The answer to an entry the dispatcher wrote (write-ahead) and appended; every 100th entry
   * also gets a snapshot, now that the document holds the entry.
   */
  Change written(const ops::LogEntry& entry) {
    if (entry.seq % SNAPSHOT_EVERY == 0) {
      auto saved = file->saveSnapshot(entry.seq, snapshotJson(*runtime->doc, entry.seq));
      // The entry is stored; a missing snapshot only makes the next load replay more.
      if (!saved) {
        std::cerr << "tinycad storage: snapshot " << entry.seq << " of document '"
                  << file->id().str() << "' failed: " << saved.error().message << '\n';
      }
    }
    return changeOf(ops::logEntryJson(entry), false);
  }

  /** The result of dispatch, undo or redo (the dispatcher ran with `currentKey` set). */
  core::Result<Change, ChangeError> finish(const core::Result<ops::LogEntry, ops::DispatchError>& entry) {
    currentKey.reset();
    if (entry) return written(*entry);
    const ops::DispatchError& error = entry.error();
    if (error.kind == ops::DispatchError::Kind::Invalid) return core::fail(invalidOperation(error));
    // Nothing was appended. The inverse brought the document back, unless it failed too (a
    // handler bug): then the file is the only trustworthy state (N155 fallback).
    ChangeError failed = changeError(ChangeErrorCode::Storage, error.message);
    if (!error.reverted) {
      reload();
      failed.reloaded = !broken;
    }
    return core::fail(std::move(failed));
  }

  /** The in-memory state from the file again; when that fails too, the document is broken. */
  void reload() {
    auto reloaded = loadRuntime(*file, deps);
    if (!reloaded) {
      broken = true;
      std::cerr << "tinycad storage: reloading document '" << file->id().str()
                << "' failed: " << reloaded.error().message << '\n';
      return;
    }
    use(std::move(*reloaded));
  }

  /** Storage when broken, else nullopt (for the in-memory calls). */
  [[nodiscard]] std::optional<ChangeError> brokenError() const {
    if (!broken) return std::nullopt;
    return changeError(ChangeErrorCode::Storage, "the document is broken");
  }
};

core::Result<std::unique_ptr<PersistentDocument>, LoadError> PersistentDocument::open(
    std::unique_ptr<DocumentFile> file, const Dependencies& deps) {
  auto runtime = Impl::loadRuntime(*file, deps);
  if (!runtime) return core::fail(std::move(runtime.error()));
  auto impl = std::make_unique<Impl>(std::move(file), deps, std::move(*runtime));
  // The constructor is private: no make_unique.
  return std::unique_ptr<PersistentDocument>(new PersistentDocument(std::move(impl)));
}

PersistentDocument::PersistentDocument(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

PersistentDocument::~PersistentDocument() = default;

const document::DocumentReader& PersistentDocument::document() const { return *impl_->runtime->doc; }

const ops::OperationLog& PersistentDocument::log() const { return impl_->runtime->log; }

bool PersistentDocument::canUndo() const { return impl_->runtime->undo.canUndo(); }

bool PersistentDocument::canRedo() const { return impl_->runtime->undo.canRedo(); }

bool PersistentDocument::inTransaction() const { return impl_->inTransaction(); }

bool PersistentDocument::broken() const { return impl_->broken; }

core::Result<std::optional<Change>, ChangeError> PersistentDocument::lookup(
    const OperationKey& key) {
  return impl_->lookup(key);
}

// --- durable ------------------------------------------------------------------------------

core::Result<Change, ChangeError> PersistentDocument::dispatch(const core::Json& operation,
                                                               const std::string& label,
                                                               const OperationKey& key) {
  if (auto done = impl_->repeatedOrRefused(key)) return *done;
  if (impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::TransactionOpen,
                                  "dispatch: a transaction is open, use it instead"));
  }
  ops::DispatchMeta meta;
  // An empty label means the default: the type of the operation (spec 04).
  if (!label.empty()) meta.label = label;
  impl_->currentKey = key;
  return impl_->finish(impl_->runtime->dispatcher.dispatch(operation, meta));
}

core::Result<Change, ChangeError> PersistentDocument::commit(const OperationKey& key) {
  if (auto done = impl_->repeatedOrRefused(key)) return *done;
  if (!impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::NoTransaction, "commit: no transaction"));
  }
  impl_->currentKey = key;
  auto committed = impl_->runtime->transaction->commit();
  impl_->currentKey.reset();
  // Nothing was appended (N155): the transaction stays open with its logged steps applied, so a
  // retried Commit writes it.
  if (!committed) {
    return core::fail(changeError(ChangeErrorCode::Storage, committed.error().message));
  }
  impl_->runtime->transaction.reset();
  if (!*committed) return Change{};
  return impl_->written(**committed);
}

core::Result<Change, ChangeError> PersistentDocument::undo(const OperationKey& key) {
  if (auto done = impl_->repeatedOrRefused(key)) return *done;
  if (impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::TransactionOpen, "undo: a transaction is open"));
  }
  if (!impl_->runtime->undo.canUndo()) {
    return core::fail(changeError(ChangeErrorCode::NothingToUndo, "nothing to undo"));
  }
  impl_->currentKey = key;
  return impl_->finish(impl_->runtime->undo.undo());
}

core::Result<Change, ChangeError> PersistentDocument::redo(const OperationKey& key) {
  if (auto done = impl_->repeatedOrRefused(key)) return *done;
  if (impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::TransactionOpen, "redo: a transaction is open"));
  }
  if (!impl_->runtime->undo.canRedo()) {
    return core::fail(changeError(ChangeErrorCode::NothingToRedo, "nothing to redo"));
  }
  impl_->currentKey = key;
  return impl_->finish(impl_->runtime->undo.redo());
}

// --- in memory ----------------------------------------------------------------------------

core::Result<void, ChangeError> PersistentDocument::begin(const std::string& label) {
  if (auto error = impl_->brokenError()) return core::fail(*error);
  if (impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::TransactionOpen, "begin: a transaction is open"));
  }
  impl_->runtime->transaction = impl_->runtime->dispatcher.begin(label);
  return {};
}

core::Result<void, ChangeError> PersistentDocument::apply(const core::Json& operation) {
  if (auto error = impl_->brokenError()) return core::fail(*error);
  if (!impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::NoTransaction, "apply: no transaction"));
  }
  auto applied = impl_->runtime->transaction->apply(operation);
  if (!applied) return core::fail(invalidOperation(applied.error()));
  return {};
}

core::Result<void, ChangeError> PersistentDocument::applyTransient(const core::Json& operation) {
  if (auto error = impl_->brokenError()) return core::fail(*error);
  if (!impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::NoTransaction, "applyTransient: no transaction"));
  }
  auto applied = impl_->runtime->transaction->applyTransient(operation);
  if (!applied) return core::fail(invalidOperation(applied.error()));
  return {};
}

core::Result<void, ChangeError> PersistentDocument::abort() {
  if (auto error = impl_->brokenError()) return core::fail(*error);
  if (!impl_->inTransaction()) {
    return core::fail(changeError(ChangeErrorCode::NoTransaction, "abort: no transaction"));
  }
  impl_->runtime->transaction->abort();
  impl_->runtime->transaction.reset();
  return {};
}

}  // namespace tinycad::storage
