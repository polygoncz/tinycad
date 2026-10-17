#pragma once

// The document catalog as an application service (spec 14 "DocumentService", spec 05 "Export a
// import souboru"): list, create, rename, delete, import and export `.tinycad.json`. No gRPC here
// (decision N37 ⚠): the gRPC adapter of tinycad.v1.DocumentService, the error mapping to
// google.rpc.Status and the routing of RenameDocument to the session of an OPEN document are M45.
//
// Durable idempotence (spec 14): create and importFile remember the OperationKey in the meta table
// of the new file (N39), rename writes it with its document.rename entry; a repeated id returns the
// same document, the same id with another fingerprint → OperationIdReused.

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/storage/persistent_document.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

struct DocumentSummary {
  DocumentId id;
  std::string name;
  /** ms since the epoch. */
  double createdAt = 0;
  double updatedAt = 0;
};

struct ExportedFile {
  /** The UTF-8 JSON of the TinycadFile (formatVersion 2, with history), JSON.stringify spacing-free. */
  std::string content;
  /** '<name>.tinycad.json' with characters unsafe in file names replaced by '_'. */
  std::string fileName;
};

enum class ServiceErrorCode {
  /** No document with the id (export, rename). */
  NotFound,
  /** Import: the file does not load; `issues` with paths relative to the file (spec 05). */
  InvalidDocument,
  /** create, rename: the trimmed name is empty. */
  InvalidName,
  OperationIdReused,
  /** The stored document does not load (export, rename of a closed document). */
  BrokenDocument,
  /** SQLite or the file system failed. */
  Storage,
};

struct ServiceError {
  ServiceErrorCode code = ServiceErrorCode::Storage;
  std::vector<document::DocumentLoadIssue> issues;
  std::string message;
};

template <class T>
using ServiceResult = core::Result<T, ServiceError>;

class DocumentService {
 public:
  struct Dependencies {
    DocumentCatalog& catalog;
    const document::FeatureSchemaRegistryReader& schemas;
    const ops::OpHandlerRegistry& handlers;
    WallClock now;
    /** A new document id (UUID v4 in the server; sequential in tests). */
    std::function<std::string()> newId;
  };

  /** `deps` must outlive the service. Not thread-safe: M45 serializes catalog calls. */
  explicit DocumentService(const Dependencies& deps);

  /** Most recently updated first. */
  ServiceResult<std::vector<DocumentSummary>> list();

  /** A new empty document named `name` (trimmed), base snapshot atSeq 0, no entries. */
  ServiceResult<DocumentSummary> create(const std::string& name, const OperationKey& key);

  /**
   * Appends document.rename to the log of a CLOSED document (opens a PersistentDocument and
   * dispatches). An open document must be renamed through its session (M45 routes it), otherwise
   * two writers would race for the next seq.
   */
  ServiceResult<DocumentSummary> rename(const DocumentId& id, const std::string& name,
                                        const OperationKey& key);

  /** Deletes the document; a missing id succeeds. M45 refuses it for an open document. */
  ServiceResult<void> remove(const DocumentId& id);

  /**
   * importDocument of spec 05 over a UTF-8 JSON text: format 1 or 2, with or without history,
   * every check and path as in TS; a new id (newId) and createdAt (now), the name from the file.
   * Nothing is stored for a broken file; a failure after create removes the half document.
   */
  ServiceResult<DocumentSummary> importFile(std::string_view utf8Json, const OperationKey& key);

  /** exportStoredDocument of spec 05: the stored state with the base snapshot and the whole log. */
  ServiceResult<ExportedFile> exportFile(const DocumentId& id);

 private:
  Dependencies deps_;
};

}  // namespace tinycad::storage
