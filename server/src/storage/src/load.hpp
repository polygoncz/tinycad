#pragma once

// Loading stored data (port of src/persistence/load.ts, spec 05 "Načtení dokumentu"): over a
// StoredDocument and JSON, without files, so it is tested without SQLite. Shared by
// PersistentDocument, the export and the import of `.tinycad.json` (tinycad_file.hpp).

#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/storage/persistent_document.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

/** A document loaded from a snapshot and the atSeq it stands at. */
struct LoadedSnapshot {
  std::unique_ptr<document::Document> doc;
  std::int64_t atSeq = 0;
};

/** What loadDocument returns: the current document and the whole log (for undo). */
struct LoadedDocument {
  std::unique_ptr<document::Document> doc;
  std::vector<ops::LogEntry> entries;
};

/** LoadError{Entry} with one issue. */
LoadError entryError(std::int64_t seq, std::string path, std::string message);

/**
 * Every entry through parseLogEntry, in order, with seq 1..n and no gaps: the first broken entry
 * is Entry with its 1-based position, the parse path ('op.name', 'label') or 'seq' for a gap.
 */
core::Result<std::vector<ops::LogEntry>, LoadError> parseEntries(
    const ops::OpHandlerRegistry& handlers, std::span<const core::Json> raw);

/**
 * The snapshot envelope, then fromData (paths relative to the snapshot): format, formatVersion
 * (1; a higher one says "newer"), atSeq a whole number in 0..maxAtSeq (`atSeqMessage` says why),
 * then the issues of fromData under 'document'. Shared with the import.
 */
core::Result<LoadedSnapshot, document::DocumentLoadError> parseSnapshot(
    const core::Json& raw, const document::FeatureSchemaRegistryReader& schemas,
    std::int64_t maxAtSeq, const std::string& atSeqMessage);

/**
 * parseSnapshot with atSeq in 0..lastSeq and meta.id == id ('document.meta.id'); a failure is
 * LoadError of `which` (Snapshot or Base).
 */
core::Result<LoadedSnapshot, LoadError> loadSnapshot(
    const core::Json& raw, const document::DocumentId& id, std::int64_t lastSeq,
    const document::FeatureSchemaRegistryReader& schemas, LoadError::Kind which);

/** loadSnapshot as the base: also atSeq == 0 (Base, path 'atSeq'). */
core::Result<LoadedSnapshot, LoadError> loadBaseSnapshot(
    const core::Json& raw, const document::DocumentId& id, std::int64_t lastSeq,
    const document::FeatureSchemaRegistryReader& schemas);

/**
 * Applies the entries one at a time, so a failing one is named: a handler error is Entry with
 * path 'op' (a broken log is broken data, not a bug). An exception is a bug and propagates.
 */
core::Result<void, LoadError> replayEach(document::DocumentWriter& doc,
                                         const ops::OpHandlerRegistry& handlers,
                                         std::span<const ops::LogEntry> entries);

/**
 * Opens stored data (loadDocument of spec 05): parses every entry, rebuilds the undo stacks (an
 * undo or redo entry off the top of its stack is Entry with path 'target'), loads the latest
 * snapshot, replays the entries after it. With `verify` also loads the base snapshot (Base
 * errors), replays the whole log from it (Entry errors); when the two states differ, Snapshot
 * with path 'document' (N108).
 */
core::Result<LoadedDocument, LoadError> loadDocument(
    const StoredDocument& stored, const document::DocumentId& id,
    const document::FeatureSchemaRegistryReader& schemas, const ops::OpHandlerRegistry& handlers,
    bool verify);

/** Structural equality of two documents (their DocumentData JSON, key order ignored). */
bool sameDocumentData(const document::DocumentReader& a, const document::DocumentReader& b);

}  // namespace tinycad::storage
