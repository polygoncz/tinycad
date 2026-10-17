#pragma once

// A document open for changes with its log persisted (spec 05, spec 14 "Změny dokumentu" and
// "Idempotence", decisions N35, N36): the in-memory document, operation log, dispatcher and undo of
// ops (M40) over one DocumentFile. The core of the runtime document of M45: the session layer adds
// sessions, the write lock, in-memory idempotence of transaction steps, regeneration and the read
// model on top.
//
// Rules:
// - "Saved = answered": dispatch, commit, undo and redo write their log entry to SQLite BEFORE
//   they return. At most one entry per call.
// - Durable idempotence: each of them takes an OperationKey. A key whose id is stored returns the
//   stored entry without applying anything (repeated = true); the same id with another
//   fingerprint → OperationIdReused.
// - A failed write → Storage, and the in-memory state is RELOADED from the file (N35 ⚠, instead
//   of applying the inverse): the log and the document then always match what is on disk. When
//   even the reload fails, the document is broken and every later call returns Storage.
// - A snapshot after every SNAPSHOT_EVERY-th entry (seq % 100 == 0, spec 05); a failed snapshot
//   is not an error of the change (the entry is stored) and is only reported to stderr.
//
// The ops types are forward-declared: their headers are those of M40 (tinycad/ops/*.hpp, designed
// by the M40 implementer). The main session aligns the names at the start of M41.

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::ops {
class OperationLog;
class OpHandlerRegistry;
}  // namespace tinycad::ops

namespace tinycad::storage {

/** Every 100th entry gets a snapshot (spec 05 snapshotEvery). */
inline constexpr std::int64_t SNAPSHOT_EVERY = 100;

/** Why stored data could not be loaded (spec 05 LoadDocumentError, Q033). */
struct LoadError {
  enum class Kind {
    /**
     * The latest snapshot: envelope or fromData (issue paths 'format', 'atSeq', 'document.…'), or
     * with verify a snapshot the log from the base does not reproduce ('document').
     */
    Snapshot,
    /** The base snapshot (verify only). */
    Base,
    /**
     * A log entry: parseLogEntry, a seq gap ('seq'), an undo or redo entry off the top of its
     * stack ('target') or a handler refusing it on replay ('op').
     */
    Entry,
    /** The file could not be read (StoreError Io). */
    Storage,
  };
  Kind kind = Kind::Storage;
  /** Entry only: the 1-based seq of the broken entry. */
  std::int64_t seq = 0;
  /** Snapshot, Base, Entry: paths as in TS (spec 05 "Cesty v chybách"); texts never compared. */
  std::vector<document::DocumentLoadIssue> issues;
  std::string message;
};

/** The error codes of durable and transaction calls; the session maps them to errors.proto. */
enum class ChangeErrorCode {
  /** The operation failed validation (spec 04): `path` says where. Document unchanged. */
  InvalidOperation,
  /** dispatch, begin, undo or redo while a transaction is open. */
  TransactionOpen,
  /** apply, applyTransient, commit or abort without a transaction. */
  NoTransaction,
  NothingToUndo,
  NothingToRedo,
  /** The same operation id with another fingerprint. */
  OperationIdReused,
  /** Writing failed; the in-memory state was reloaded from the file (N35). */
  Storage,
};

struct ChangeError {
  ChangeErrorCode code = ChangeErrorCode::Storage;
  /** InvalidOperation: the path of OperationLoadError ('ops[1].feature.params'). */
  std::string path;
  /** Technical text; never compared. */
  std::string message;
};

struct Change {
  /** The written (or, when repeated, the stored) LogEntry JSON; nullopt for an empty commit. */
  std::optional<core::Json> entry;
  /** True when the operation id was already stored and nothing was applied now. */
  bool repeated = false;
};

// After a Storage error the document is reloaded from its file (N35): the whole runtime (document,
// log, dispatcher, undo, transaction) is replaced, so references obtained earlier from document()
// or log() are invalid and callers (the session layer, M45) must fetch them again.
class PersistentDocument {
 public:
  struct Dependencies {
    /** The one schema registry of the server; also the one the handlers were built with (spec 05). */
    const document::FeatureSchemaRegistryReader& schemas;
    const ops::OpHandlerRegistry& handlers;
    /** ms since the epoch for LogEntry::time. */
    WallClock now;
    /** Replay the whole log from the base snapshot and compare (spec 05 verify); tests: true. */
    bool verify = false;
  };

  /**
   * Opens a stored document (spec 05 "Načtení dokumentu"): parses every entry, rebuilds the undo
   * stacks from the whole log (a corrupt undo target is Entry, path 'target'), loads the latest
   * snapshot, replays the entries after it; with verify also replays from the base, a mismatch is
   * Snapshot with path 'document'. Data from the file never throw (N108).
   * Takes ownership of the file. `deps` must outlive the document.
   */
  static core::Result<std::unique_ptr<PersistentDocument>, LoadError> open(
      std::unique_ptr<DocumentFile> file, const Dependencies& deps);

  ~PersistentDocument();
  PersistentDocument(const PersistentDocument&) = delete;
  PersistentDocument& operator=(const PersistentDocument&) = delete;

  [[nodiscard]] const document::DocumentReader& document() const;
  [[nodiscard]] const ops::OperationLog& log() const;
  [[nodiscard]] bool canUndo() const;
  [[nodiscard]] bool canRedo() const;
  [[nodiscard]] bool inTransaction() const;
  /** True after a failed reload (N35): every change returns Storage. */
  [[nodiscard]] bool broken() const;

  /**
   * The durable idempotence check alone (spec 14 "Vlákna a zámky serveru", N107): the stored
   * entry when the key was written already (Change with repeated = true), nullopt when the id is
   * not stored yet, OperationIdReused for the same id with another fingerprint, Storage when the
   * document is broken or the file cannot be read. Changes nothing. The session calls it BEFORE it
   * re-solves a sketch, so a repeated request is never solved again; every durable call below
   * makes the same check first.
   */
  core::Result<std::optional<Change>, ChangeError> lookup(const OperationKey& key);

  // --- durable: at most one log entry, written before return --------------------------------

  /** OperationDispatcher::dispatch (one entry). */
  core::Result<Change, ChangeError> dispatch(const core::Json& operation, const std::string& label,
                                             const OperationKey& key);
  /** Transaction::commit (0 or 1 entry; an empty transaction gives Change without entry). */
  core::Result<Change, ChangeError> commit(const OperationKey& key);
  core::Result<Change, ChangeError> undo(const OperationKey& key);
  core::Result<Change, ChangeError> redo(const OperationKey& key);

  // --- in memory: never in the log (spec 14: idempotence of these is the session's) ---------

  core::Result<void, ChangeError> begin(const std::string& label);
  core::Result<void, ChangeError> apply(const core::Json& operation);
  core::Result<void, ChangeError> applyTransient(const core::Json& operation);
  core::Result<void, ChangeError> abort();

 private:
  struct Impl;
  explicit PersistentDocument(std::unique_ptr<Impl> impl);
  std::unique_ptr<Impl> impl_;
};

}  // namespace tinycad::storage
