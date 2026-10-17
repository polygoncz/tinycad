#include "load.hpp"

#include <exception>
#include <utility>

#include "tinycad/ops/parse_entry.hpp"
#include "tinycad/ops/replay.hpp"

namespace tinycad::storage {

namespace {

LoadError snapshotError(LoadError::Kind which, std::vector<document::DocumentLoadIssue> issues) {
  LoadError error;
  error.kind = which;
  error.issues = std::move(issues);
  error.message = which == LoadError::Kind::Base ? "the base snapshot does not load"
                                                 : "the latest snapshot does not load";
  return error;
}

/** Format version 1 is the only known one; a higher one asks for an update. */
std::optional<document::DocumentLoadIssue> formatVersionIssue(const core::Json* formatVersion) {
  if (formatVersion != nullptr && core::isWholeNumber(*formatVersion)) {
    const double version = core::numberOf(*formatVersion);
    if (version == 1) return std::nullopt;
    if (version > 1) {
      return document::DocumentLoadIssue{
          "formatVersion",
          "Version " + core::numberJson(version).dump() + " is newer than the known 1; update the app"};
    }
  }
  return document::DocumentLoadIssue{"formatVersion", "Must be 1"};
}

const core::Json* field(const core::Json& object, const char* key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

}  // namespace

LoadError entryError(std::int64_t seq, std::string path, std::string message) {
  LoadError error;
  error.kind = LoadError::Kind::Entry;
  error.seq = seq;
  error.message = "log entry " + std::to_string(seq) + ": " + message;
  error.issues.push_back(document::DocumentLoadIssue{std::move(path), std::move(message)});
  return error;
}

core::Result<std::vector<ops::LogEntry>, LoadError> parseEntries(
    const ops::OpHandlerRegistry& handlers, std::span<const core::Json> raw) {
  std::vector<ops::LogEntry> entries;
  entries.reserve(raw.size());
  for (std::size_t i = 0; i < raw.size(); ++i) {
    const auto seq = static_cast<std::int64_t>(i + 1);
    auto parsed = ops::parseLogEntry(handlers, raw[i]);
    if (!parsed) return core::fail(entryError(seq, parsed.error().path, parsed.error().message));
    if (parsed->seq != seq) {
      return core::fail(entryError(seq, "seq",
                                   "Expected " + std::to_string(seq) + ", got " +
                                       std::to_string(parsed->seq)));
    }
    entries.push_back(std::move(*parsed));
  }
  return entries;
}

core::Result<LoadedSnapshot, document::DocumentLoadError> parseSnapshot(
    const core::Json& raw, const document::FeatureSchemaRegistryReader& schemas,
    std::int64_t maxAtSeq, const std::string& atSeqMessage) {
  if (!raw.is_object()) {
    return core::fail(document::DocumentLoadError{{{"", "Must be an object"}}});
  }
  std::vector<document::DocumentLoadIssue> issues;
  const core::Json* format = field(raw, "format");
  if (format == nullptr || *format != "tinycad.snapshot") {
    issues.push_back({"format", "Must be 'tinycad.snapshot'"});
  }
  if (auto version = formatVersionIssue(field(raw, "formatVersion"))) issues.push_back(*version);
  const core::Json* atSeq = field(raw, "atSeq");
  const bool atSeqValid = atSeq != nullptr && core::isWholeNumber(*atSeq) &&
                          core::numberOf(*atSeq) >= 0 &&
                          core::numberOf(*atSeq) <= static_cast<double>(maxAtSeq);
  if (!atSeqValid) issues.push_back({"atSeq", atSeqMessage});
  if (!issues.empty()) return core::fail(document::DocumentLoadError{std::move(issues)});

  const core::Json* data = field(raw, "document");
  auto loaded = document::fromData(data != nullptr ? *data : core::Json(), schemas);
  if (!loaded) {
    for (const auto& issue : loaded.error().issues) {
      issues.push_back({issue.path.empty() ? "document" : "document." + issue.path, issue.message});
    }
    return core::fail(document::DocumentLoadError{std::move(issues)});
  }
  return LoadedSnapshot{std::move(*loaded), static_cast<std::int64_t>(core::numberOf(*atSeq))};
}

core::Result<LoadedSnapshot, LoadError> loadSnapshot(
    const core::Json& raw, const document::DocumentId& id, std::int64_t lastSeq,
    const document::FeatureSchemaRegistryReader& schemas, LoadError::Kind which) {
  auto parsed = parseSnapshot(raw, schemas, lastSeq,
                              "Must be a whole number in 0.." + std::to_string(lastSeq) +
                                  " (the stored entries)");
  if (!parsed) return core::fail(snapshotError(which, std::move(parsed.error().issues)));
  if (parsed->doc->meta().id != id) {
    return core::fail(snapshotError(
        which, {{"document.meta.id", "Must be the loaded document id '" + id.str() + "'"}}));
  }
  return std::move(*parsed);
}

core::Result<LoadedSnapshot, LoadError> loadBaseSnapshot(
    const core::Json& raw, const document::DocumentId& id, std::int64_t lastSeq,
    const document::FeatureSchemaRegistryReader& schemas) {
  auto base = loadSnapshot(raw, id, lastSeq, schemas, LoadError::Kind::Base);
  if (!base) return base;
  if (base->atSeq != 0) {
    return core::fail(snapshotError(LoadError::Kind::Base, {{"atSeq", "Must be 0"}}));
  }
  return base;
}

core::Result<void, LoadError> replayEach(document::DocumentWriter& doc,
                                         const ops::OpHandlerRegistry& handlers,
                                         std::span<const ops::LogEntry> entries) {
  for (const ops::LogEntry& entry : entries) {
    try {
      auto replayed = ops::replayLog(doc, handlers, {entry});
      if (!replayed) return core::fail(entryError(entry.seq, "op", replayed.error().error.message));
    } catch (const std::exception& e) {
      // A document mutator asserting on data from the file: broken data, not a bug here.
      return core::fail(entryError(entry.seq, "op", e.what()));
    }
  }
  return {};
}

bool sameDocumentData(const document::DocumentReader& a, const document::DocumentReader& b) {
  return document::documentDataJson(document::toData(a)) ==
         document::documentDataJson(document::toData(b));
}

core::Result<LoadedDocument, LoadError> loadDocument(
    const StoredDocument& stored, const document::DocumentId& id,
    const document::FeatureSchemaRegistryReader& schemas, const ops::OpHandlerRegistry& handlers,
    bool verify) {
  std::vector<core::Json> raw;
  raw.reserve(stored.entries.size());
  for (const StoredEntry& entry : stored.entries) raw.push_back(entry.entry);
  auto entries = parseEntries(handlers, raw);
  if (!entries) return core::fail(std::move(entries.error()));
  const auto lastSeq = static_cast<std::int64_t>(entries->size());

  auto latest = loadSnapshot(stored.snapshot, id, lastSeq, schemas, LoadError::Kind::Snapshot);
  if (!latest) return core::fail(std::move(latest.error()));
  const std::span<const ops::LogEntry> rest =
      std::span<const ops::LogEntry>(*entries).subspan(static_cast<std::size_t>(latest->atSeq));
  auto replayed = replayEach(*latest->doc, handlers, rest);
  if (!replayed) return core::fail(std::move(replayed.error()));

  if (verify) {
    auto base = loadBaseSnapshot(stored.base, id, lastSeq, schemas);
    if (!base) return core::fail(std::move(base.error()));
    // A handler refusing an entry is broken data here too, not broken determinism.
    auto fromBase = replayEach(*base->doc, handlers, *entries);
    if (!fromBase) return core::fail(std::move(fromBase.error()));
    TINYCAD_ASSERT(sameDocumentData(*base->doc, *latest->doc),
                   "loadDocument: document '" + id.str() +
                       "' replayed from the base snapshot differs from snapshot " +
                       std::to_string(latest->atSeq) +
                       " + log (operations are not deterministic)");
  }
  return LoadedDocument{std::move(latest->doc), std::move(*entries)};
}

}  // namespace tinycad::storage
