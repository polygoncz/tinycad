#pragma once

// Document storage of the native core (spec 05, ADR 0030 point 7, decisions N32–N34, N39): one
// SQLite file per document in a data directory (a Docker volume). The C++ counterpart of the TS
// DocumentStore port, split into two roles (OOP, N9):
//
// - DocumentCatalog: the directory – list, create, open, delete; no catalog database, the files
//   are the single source of truth (N32).
// - DocumentFile: one open document (one SQLite connection, WAL) – append log entries, save
//   snapshots, load, find an entry by operation_id.
//
// Stored data are JSON exactly as in TS: a log entry is the LogEntry JSON of spec 04 (with `v` and
// upcast, ADR 0005), a snapshot the DocumentSnapshot JSON of spec 05. The store never interprets
// them beyond what it must (the document.rename of an entry, the meta.id of a snapshot), so it does
// not depend on ops (N33). Checking and replaying them is load.hpp (M41) and the ops library.
//
// Expected failures are values (core::Result); an SQLite or file-system failure is StoreError
// { Io }, which the session reports as STORAGE (spec 14). Never throws except AssertionError.

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/model.hpp"

namespace tinycad::storage {

using core::Json;
using document::DocumentId;
using document::DocumentMeta;

enum class StoreErrorCode {
  /** No document with the id. */
  NotFound,
  /** create with an id that exists. */
  AlreadyExists,
  /** The first appended seq is not lastSeq + 1, or the batch is not consecutive (N34). */
  SeqGap,
  /** A snapshot with atSeq > lastSeq. */
  SnapshotAhead,
  /** Broken input: seq < 1, atSeq < 1, snapshot meta.id ≠ document id, an unsafe document id. */
  Invalid,
  /** An entry with an operation_id that is already stored (the unique index, N34). */
  DuplicateOperation,
  /** SQLite or the file system failed; the session reports STORAGE and may retry. */
  Io,
};

/** "not-found", "already-exists", "seq-gap", "snapshot-ahead", "invalid", "duplicate-operation", "io". */
std::string_view storeErrorCodeName(StoreErrorCode code);

struct StoreError {
  StoreErrorCode code = StoreErrorCode::Io;
  /** Technical text (the SQLite message for Io); never compared by tests. */
  std::string message;
};

template <class T>
using StoreResult = core::Result<T, StoreError>;

/** What the catalog lists (spec 05 DocumentInfo). */
struct DocumentInfo {
  /** meta.name follows the last stored document.rename (spec 05, D5 of M19.2). */
  DocumentMeta meta;
  /** Highest stored seq, 0 = no entries. */
  std::int64_t lastSeq = 0;
  /** ms since the epoch of the last append (create counts). */
  double updatedAt = 0;
};

/**
 * Identifies a durable request (spec 14 "Idempotence"): the UUID the client sends and a
 * fingerprint of the request content (canonical bytes or a digest, chosen by the session, M45).
 * The same id with another fingerprint is OPERATION_ID_REUSED.
 */
struct OperationKey {
  std::string id;
  std::string fingerprint;
};

/** One stored log entry. */
struct StoredEntry {
  std::int64_t seq = 0;
  /** nullopt for entries without a request (imported history, N38). */
  std::optional<OperationKey> operation;
  /** The LogEntry JSON of spec 04. */
  Json entry;
};

/** What load returns: raw data, checked by loadDocument (spec 05 "parse, don't validate"). */
struct StoredDocument {
  /** The snapshot with the highest atSeq (DocumentSnapshot JSON). */
  Json snapshot;
  /** The snapshot with atSeq 0. */
  Json base;
  /** All entries ordered by seq. */
  std::vector<StoredEntry> entries;
};

/**
 * One open document: one SQLite connection in WAL mode (synchronous FULL). Every method is one
 * SQLite transaction and checks its contract BEFORE writing: a refused call changes nothing.
 * Used by one thread at a time (the session serializes, spec 14); not copyable.
 */
class DocumentFile {
 public:
  virtual ~DocumentFile() = default;

  [[nodiscard]] virtual const DocumentId& id() const = 0;
  virtual StoreResult<DocumentInfo> info() = 0;

  /**
   * Appends entries atomically (spec 05 appendEntries, tightened by N34): empty = nothing (not
   * even updatedAt); each seq an integer ≥ 1 (else Invalid); the first seq == lastSeq + 1 and the
   * batch consecutive (else SeqGap, no overwrite of stored seqs); an operation id already stored
   * → DuplicateOperation. Sets lastSeq and updatedAt = now; a top-level document.rename in the
   * batch sets meta.name to the name of the last one, in the same transaction.
   * Check order: Invalid, SeqGap, DuplicateOperation.
   */
  virtual StoreResult<void> appendEntries(std::span<const StoredEntry> entries) = 0;

  /**
   * Saves a snapshot (spec 05 saveSnapshot): atSeq an integer ≥ 1 and snapshot.document.meta.id
   * == id() (else Invalid); atSeq > lastSeq → SnapshotAhead; the same atSeq overwrites;
   * updatedAt unchanged; in the same transaction keeps only the base (atSeq 0) and the 3
   * snapshots with the highest atSeq (Q009). Check order: Invalid, SnapshotAhead.
   */
  virtual StoreResult<void> saveSnapshot(std::int64_t atSeq, const Json& snapshot) = 0;

  virtual StoreResult<StoredDocument> load() = 0;

  /** The entry written for the operation id (idempotent repeat), nullopt when none. */
  virtual StoreResult<std::optional<StoredEntry>> findEntry(std::string_view operationId) = 0;
};

class DocumentCatalog {
 public:
  virtual ~DocumentCatalog() = default;

  /** Every readable document, most recently updated first; an unreadable file is skipped. */
  virtual StoreResult<std::vector<DocumentInfo>> list() = 0;

  /**
   * Creates the file of a new document with its base snapshot (atSeq 0, spec 05): an existing id
   * → AlreadyExists (checked first); an unsafe id (not [A-Za-z0-9_-]{1,64}), initial.atSeq ≠ 0
   * or initial meta.id ≠ meta.id → Invalid. `createdBy` (CreateDocument, ImportDocument) is
   * stored in the meta table for idempotence (N39). Atomic: written to a temporary file and
   * renamed, so a crash leaves no half document. Returns the open file.
   */
  virtual StoreResult<std::unique_ptr<DocumentFile>> create(
      const DocumentMeta& meta, const Json& initialSnapshot,
      const std::optional<OperationKey>& createdBy) = 0;

  /** NotFound for a missing (or unsafe) id. */
  virtual StoreResult<std::unique_ptr<DocumentFile>> open(const DocumentId& id) = 0;

  /** Deletes the file with its WAL; a missing id succeeds (idempotent). */
  virtual StoreResult<void> remove(const DocumentId& id) = 0;

  /** The document created by the operation id and the key it was created with; nullopt = none. */
  virtual StoreResult<std::optional<std::pair<DocumentId, OperationKey>>> findCreated(
      std::string_view operationId) = 0;
};

/** ms since the Unix epoch; injected so tests are deterministic (spec 05: the store has no clock). */
using WallClock = std::function<double()>;

/**
 * The SQLite catalog over `directory` (created when missing): files '<id>.tinycad.sqlite' with
 * the tables meta(key, value), operations(seq PK, operation_id UNIQUE, fingerprint, entry) and
 * snapshots(at_seq PK, snapshot), PRAGMA user_version 1 (N32). Safe to call from several threads
 * for different documents.
 */
std::unique_ptr<DocumentCatalog> openSqliteCatalog(std::filesystem::path directory, WallClock now);

}  // namespace tinycad::storage
