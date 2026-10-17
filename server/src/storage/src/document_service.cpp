#include "tinycad/storage/document_service.hpp"

#include <utility>

#include "snapshot.hpp"
#include "tinycad/core/text.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad_file.hpp"

namespace tinycad::storage {

namespace {

ServiceError serviceError(ServiceErrorCode code, std::string message,
                          std::vector<document::DocumentLoadIssue> issues = {}) {
  return ServiceError{code, std::move(issues), std::move(message)};
}

ServiceError storageError(const StoreError& error) {
  return serviceError(ServiceErrorCode::Storage, error.message);
}

DocumentSummary summaryOf(const DocumentInfo& info) {
  return DocumentSummary{info.meta.id, info.meta.name, info.meta.createdAt, info.updatedAt};
}

/** The summary of an open file. */
ServiceResult<DocumentSummary> summaryOf(DocumentFile& file) {
  auto info = file.info();
  if (!info) return core::fail(storageError(info.error()));
  return summaryOf(*info);
}

/**
 * The document created by the key earlier (N39): its summary for the same fingerprint,
 * OperationIdReused for another one, nullopt when the key created nothing yet.
 */
std::optional<ServiceResult<DocumentSummary>> createdBefore(DocumentCatalog& catalog,
                                                            const OperationKey& key) {
  auto found = catalog.findCreated(key.id);
  if (!found) return core::fail(storageError(found.error()));
  if (!*found) return std::nullopt;
  const auto& [id, storedKey] = **found;
  if (storedKey.fingerprint != key.fingerprint) {
    return core::fail(serviceError(ServiceErrorCode::OperationIdReused,
                                   "operation id '" + key.id + "' was used for another request"));
  }
  auto file = catalog.open(id);
  if (!file) return core::fail(storageError(file.error()));
  return summaryOf(**file);
}

/**
 * safeFileName of src/app/file-names.ts: `\ / : * ? " < > |` and control characters → '_',
 * spaces and dots trimmed at both ends, at most 100 characters; empty → 'tinycad'. Bytes, not
 * UTF-16 units: the cut may differ from TS for long non-ASCII names, and never splits a UTF-8
 * sequence.
 */
std::string safeFileName(const std::string& name) {
  constexpr std::size_t maxLength = 100;
  std::string safe;
  for (const char c : name) {
    const auto byte = static_cast<unsigned char>(c);
    const bool unsafe = byte < 0x20 || byte == 0x7f || std::string_view("\\/:*?\"<>|").contains(c);
    safe += unsafe ? '_' : c;
  }
  const auto trimEdges = [](std::string& s) {
    const auto edge = [](char c) { return c == '.' || std::string_view(" \t\n\r\v\f").contains(c); };
    while (!s.empty() && edge(s.front())) s.erase(s.begin());
    while (!s.empty() && edge(s.back())) s.pop_back();
  };
  trimEdges(safe);
  if (safe.size() > maxLength) {
    std::size_t cut = maxLength;
    // Back to the start of a UTF-8 sequence (continuation bytes are 10xxxxxx).
    while (cut > 0 && (static_cast<unsigned char>(safe[cut]) & 0xC0) == 0x80) --cut;
    safe.resize(cut);
  }
  trimEdges(safe);
  return safe.empty() ? "tinycad" : safe;
}

}  // namespace

DocumentService::DocumentService(const Dependencies& deps) : deps_(deps) {}

ServiceResult<std::vector<DocumentSummary>> DocumentService::list() {
  auto infos = deps_.catalog.list();
  if (!infos) return core::fail(storageError(infos.error()));
  std::vector<DocumentSummary> summaries;
  for (const DocumentInfo& info : *infos) summaries.push_back(summaryOf(info));
  return summaries;
}

ServiceResult<DocumentSummary> DocumentService::create(const std::string& name,
                                                       const OperationKey& key) {
  const std::string trimmed = core::trimJs(name);
  if (trimmed.empty()) return core::fail(serviceError(ServiceErrorCode::InvalidName, "empty name"));
  if (auto before = createdBefore(deps_.catalog, key)) return *before;

  const DocumentMeta meta{DocumentId(deps_.newId()), trimmed, deps_.now()};
  const document::DocumentData empty{meta, std::make_shared<const document::PartStudioData>()};
  auto file = deps_.catalog.create(meta, snapshotJson(empty, 0), key);
  if (!file) return core::fail(storageError(file.error()));
  return summaryOf(**file);
}

ServiceResult<DocumentSummary> DocumentService::rename(const DocumentId& id,
                                                       const std::string& name,
                                                       const OperationKey& key) {
  const std::string trimmed = core::trimJs(name);
  if (trimmed.empty()) return core::fail(serviceError(ServiceErrorCode::InvalidName, "empty name"));

  auto file = deps_.catalog.open(id);
  if (!file) {
    if (file.error().code == StoreErrorCode::NotFound) {
      return core::fail(serviceError(ServiceErrorCode::NotFound, file.error().message));
    }
    return core::fail(storageError(file.error()));
  }
  const PersistentDocument::Dependencies documentDeps{deps_.schemas, deps_.handlers, deps_.now,
                                                      false};
  auto doc = PersistentDocument::open(std::move(*file), documentDeps);
  if (!doc) {
    const ServiceErrorCode code = doc.error().kind == LoadError::Kind::Storage
                                      ? ServiceErrorCode::Storage
                                      : ServiceErrorCode::BrokenDocument;
    return core::fail(serviceError(code, doc.error().message, doc.error().issues));
  }

  const core::Json op{{"type", "document.rename"}, {"v", ops::opVersion("document.rename")},
                      {"name", trimmed}};
  auto changed = (*doc)->dispatch(op, "document.rename", key);
  if (!changed) {
    switch (changed.error().code) {
      case ChangeErrorCode::OperationIdReused:
        return core::fail(serviceError(ServiceErrorCode::OperationIdReused, changed.error().message));
      case ChangeErrorCode::InvalidOperation:
        return core::fail(serviceError(ServiceErrorCode::InvalidName, changed.error().message));
      default:
        return core::fail(serviceError(ServiceErrorCode::Storage, changed.error().message));
    }
  }
  auto info = deps_.catalog.open(id);
  if (!info) return core::fail(storageError(info.error()));
  return summaryOf(**info);
}

ServiceResult<void> DocumentService::remove(const DocumentId& id) {
  auto removed = deps_.catalog.remove(id);
  // An id that cannot be stored (NotFound) is missing, and a missing id succeeds.
  if (!removed && removed.error().code != StoreErrorCode::NotFound) {
    return core::fail(storageError(removed.error()));
  }
  return {};
}

ServiceResult<DocumentSummary> DocumentService::importFile(std::string_view utf8Json,
                                                           const OperationKey& key) {
  if (auto before = createdBefore(deps_.catalog, key)) return *before;

  const core::Json raw = core::Json::parse(utf8Json, nullptr, false);
  if (raw.is_discarded()) {
    return core::fail(serviceError(ServiceErrorCode::InvalidDocument, "not valid JSON",
                                   {{"", "Not valid JSON"}}));
  }
  auto checked = parseTinycadFile(raw, deps_.schemas, deps_.handlers);
  if (!checked) {
    return core::fail(serviceError(ServiceErrorCode::InvalidDocument, "the file does not load",
                                   std::move(checked.error().issues)));
  }

  const DocumentMeta meta{DocumentId(deps_.newId()), checked->state.meta.name, deps_.now()};
  auto created = deps_.catalog.create(
      meta, snapshotJson(document::DocumentData{meta, checked->base.studio}, 0), key);
  if (!created) return core::fail(storageError(created.error()));
  std::unique_ptr<DocumentFile> file = std::move(*created);

  const auto n = static_cast<std::int64_t>(checked->entries.size());
  if (n > 0) {
    std::vector<StoredEntry> entries;
    entries.reserve(checked->entries.size());
    for (const ops::LogEntry& entry : checked->entries) {
      entries.push_back(StoredEntry{entry.seq, std::nullopt, ops::logEntryJson(entry)});
    }
    StoreResult<void> written = file->appendEntries(entries);
    if (written) {
      written = file->saveSnapshot(n, snapshotJson(document::DocumentData{meta, checked->state.studio}, n));
    }
    if (!written) {
      // Do not leave a half-imported document in the list; the original error matters more.
      file.reset();
      (void)deps_.catalog.remove(meta.id);
      return core::fail(storageError(written.error()));
    }
  }
  return summaryOf(*file);
}

ServiceResult<ExportedFile> DocumentService::exportFile(const DocumentId& id) {
  auto file = deps_.catalog.open(id);
  if (!file) {
    if (file.error().code == StoreErrorCode::NotFound) {
      return core::fail(serviceError(ServiceErrorCode::NotFound, file.error().message));
    }
    return core::fail(storageError(file.error()));
  }
  auto stored = (*file)->load();
  if (!stored) return core::fail(storageError(stored.error()));
  auto exported = exportStoredJson(*stored, id, deps_.schemas, deps_.handlers);
  if (!exported) {
    return core::fail(serviceError(ServiceErrorCode::BrokenDocument, exported.error().message,
                                   exported.error().issues));
  }
  const std::string name = (*exported)["snapshot"]["document"]["meta"]["name"].get<std::string>();
  return ExportedFile{exported->dump(), safeFileName(name) + ".tinycad.json"};
}

}  // namespace tinycad::storage
