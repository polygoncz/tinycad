#pragma once

// The `.tinycad.json` file (port of src/persistence/file.ts, spec 05 "Export a import souboru"):
//
//   { format: 'tinycad.file', formatVersion: 2, snapshot: DocumentSnapshot,
//     history?: { base: DocumentSnapshot, entries: LogEntry[] } }
//
// Pure functions over StoredDocument and JSON; writing the imported document is
// DocumentService::importFile.

#include <vector>

#include "load.hpp"

namespace tinycad::storage {

/**
 * The stored document with its history (exportStoredDocument): the state as loadDocument opens it
 * (without verify), the base snapshot checked as with verify, the whole log; features and
 * operations in their current versions. A file of formatVersion 2.
 */
core::Result<core::Json, LoadError> exportStoredJson(const StoredDocument& stored,
                                                     const document::DocumentId& id,
                                                     const document::FeatureSchemaRegistryReader& schemas,
                                                     const ops::OpHandlerRegistry& handlers);

/** A checked file: the state, the base it starts from (the state itself without history), the log. */
struct CheckedFile {
  document::DocumentData state;
  document::DocumentData base;
  std::vector<ops::LogEntry> entries;
};

/**
 * Checks a parsed file without writing anything (checkFile of file.ts). Groups in order, the first
 * broken one ends the check: envelope (format, formatVersion 1 or 2, history not an object),
 * snapshot, base, entries (then snapshot.atSeq == n), replay (handlers, rebuildUndoStacks, the
 * state equal to the snapshot). Paths are relative to the file ('snapshot.atSeq',
 * 'history.entries[3].op.featureId'). A version 1 file is read as in M4: its history is ignored.
 */
core::Result<CheckedFile, document::DocumentLoadError> parseTinycadFile(
    const core::Json& raw, const document::FeatureSchemaRegistryReader& schemas,
    const ops::OpHandlerRegistry& handlers);

}  // namespace tinycad::storage
