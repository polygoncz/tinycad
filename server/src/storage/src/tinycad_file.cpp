#include "tinycad_file.hpp"

#include <exception>
#include <utility>

#include "snapshot.hpp"
#include "tinycad/ops/undo.hpp"

namespace tinycad::storage {

namespace {

using document::DocumentLoadError;
using document::DocumentLoadIssue;

/** Number.MAX_SAFE_INTEGER: atSeq of a file snapshot with history is checked against n later. */
constexpr std::int64_t MAX_SAFE_INTEGER = 9007199254740991;

DocumentLoadError issue(std::string path, std::string message) {
  return DocumentLoadError{{DocumentLoadIssue{std::move(path), std::move(message)}}};
}

/** The issues of a nested value under `prefix` ('' → the prefix itself). */
DocumentLoadError under(const std::string& prefix, const DocumentLoadError& error) {
  DocumentLoadError out;
  for (const auto& i : error.issues) {
    out.issues.push_back({i.path.empty() ? prefix : prefix + "." + i.path, i.message});
  }
  return out;
}

/**
 * An entry error as a file issue. Parse errors keep their path inside the entry
 * ('history.entries[3].op.featureId'); a handler failing during replay names the entry only.
 */
DocumentLoadError entryIssue(const LoadError& error, bool withPath) {
  const std::string entry = "history.entries[" + std::to_string(error.seq - 1) + "]";
  const DocumentLoadIssue& first = error.issues.front();
  const std::string path = withPath && !first.path.empty() ? entry + "." + first.path : entry;
  return issue(path, first.message);
}

/** Version 2 is the current one, 1 is M4 without history; a higher one asks for an update. */
std::optional<DocumentLoadIssue> fileVersionIssue(const core::Json* formatVersion) {
  if (formatVersion != nullptr && core::isWholeNumber(*formatVersion)) {
    const double version = core::numberOf(*formatVersion);
    if (version == 1 || version == 2) return std::nullopt;
    if (version > 2) {
      return DocumentLoadIssue{"formatVersion", "Version " + core::numberJson(version).dump() +
                                                    " is newer than the known 2; update the app"};
    }
  }
  return DocumentLoadIssue{"formatVersion", "Must be 1 or 2"};
}

const core::Json* field(const core::Json& object, const char* key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

/** A missing field reads as null, which every check refuses like `undefined` in TS. */
const core::Json& valueOf(const core::Json* value) {
  static const core::Json null;
  return value != nullptr ? *value : null;
}

core::Result<CheckedFile, DocumentLoadError> checkHistory(
    const core::Json& rawSnapshot, const core::Json& history,
    const document::FeatureSchemaRegistryReader& schemas, const ops::OpHandlerRegistry& handlers) {
  // The exact atSeq is checked against the entries below; here only its shape.
  auto snapshot = parseSnapshot(rawSnapshot, schemas, MAX_SAFE_INTEGER, "Must be a whole number >= 0");
  if (!snapshot) return core::fail(under("snapshot", snapshot.error()));

  auto base = parseSnapshot(valueOf(field(history, "base")), schemas, 0, "Must be 0");
  if (!base) return core::fail(under("history.base", base.error()));

  const core::Json* rawEntries = field(history, "entries");
  if (rawEntries == nullptr || !rawEntries->is_array()) {
    return core::fail(issue("history.entries", "Must be an array"));
  }
  auto entries = parseEntries(handlers, rawEntries->get_ref<const core::Json::array_t&>());
  if (!entries) return core::fail(entryIssue(entries.error(), true));
  const auto n = static_cast<std::int64_t>(entries->size());
  if (snapshot->atSeq != n) {
    return core::fail(issue("snapshot.atSeq", "Must be " + std::to_string(n) + " (the history entries)"));
  }

  // The data are immutable: baseData stays the base after the replay changes the document.
  const document::DocumentData baseData = document::toData(*base->doc);
  auto applied = replayEach(*base->doc, handlers, *entries);
  if (!applied) return core::fail(entryIssue(applied.error(), false));
  try {
    (void)ops::rebuildUndoStacks(*entries);
  } catch (const std::exception& e) {
    return core::fail(issue("history.entries", e.what()));
  }
  // A file from outside may have been edited: a mismatch is broken data, not broken determinism.
  const document::DocumentData state = document::toData(*snapshot->doc);
  if (!document::sameStudio(*base->doc->studio(), *state.studio)) {
    return core::fail(issue("history", "Replayed history does not match the snapshot"));
  }
  return CheckedFile{state, baseData, std::move(*entries)};
}

}  // namespace

core::Result<core::Json, LoadError> exportStoredJson(const StoredDocument& stored,
                                                     const document::DocumentId& id,
                                                     const document::FeatureSchemaRegistryReader& schemas,
                                                     const ops::OpHandlerRegistry& handlers) {
  auto loaded = loadDocument(stored, id, schemas, handlers, false);
  if (!loaded) return core::fail(std::move(loaded.error()));
  const auto n = static_cast<std::int64_t>(loaded->entries.size());
  auto base = loadBaseSnapshot(stored.base, id, n, schemas);
  if (!base) return core::fail(std::move(base.error()));

  core::Json entries = core::Json::array();
  for (const ops::LogEntry& entry : loaded->entries) entries.push_back(ops::logEntryJson(entry));
  return core::Json{{"format", "tinycad.file"},
                    {"formatVersion", 2},
                    {"snapshot", snapshotJson(*loaded->doc, n)},
                    {"history", {{"base", snapshotJson(*base->doc, 0)}, {"entries", entries}}}};
}

core::Result<CheckedFile, DocumentLoadError> parseTinycadFile(
    const core::Json& raw, const document::FeatureSchemaRegistryReader& schemas,
    const ops::OpHandlerRegistry& handlers) {
  if (!raw.is_object()) return core::fail(issue("", "Must be an object"));
  std::vector<DocumentLoadIssue> issues;
  const core::Json* format = field(raw, "format");
  if (format == nullptr || *format != "tinycad.file") {
    issues.push_back({"format", "Must be 'tinycad.file'"});
  }
  const core::Json* formatVersion = field(raw, "formatVersion");
  if (auto version = fileVersionIssue(formatVersion)) issues.push_back(*version);
  // Only version 2 knows history; a version 1 file is read exactly as in M4.
  const bool version2 = formatVersion != nullptr && core::isFiniteNumber(*formatVersion) &&
                        core::numberOf(*formatVersion) == 2;
  const core::Json* history = version2 ? field(raw, "history") : nullptr;
  if (history != nullptr && !history->is_object()) {
    issues.push_back({"history", "Must be an object"});
  }
  if (!issues.empty()) return core::fail(DocumentLoadError{std::move(issues)});

  const core::Json& rawSnapshot = valueOf(field(raw, "snapshot"));
  if (history == nullptr) {
    auto parsed = parseSnapshot(rawSnapshot, schemas, 0, "Must be 0");
    if (!parsed) return core::fail(under("snapshot", parsed.error()));
    const document::DocumentData data = document::toData(*parsed->doc);
    return CheckedFile{data, data, {}};
  }
  return checkHistory(rawSnapshot, *history, schemas, handlers);
}

}  // namespace tinycad::storage
