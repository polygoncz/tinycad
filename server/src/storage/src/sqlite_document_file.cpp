#include "sqlite_document_file.hpp"

#include <set>
#include <utility>

#include "renamed_to.hpp"
#include "snapshot_keep.hpp"

namespace tinycad::storage {

namespace {

StoreError refused(StoreErrorCode code, std::string message) {
  return StoreError{code, std::move(message)};
}

/** A whole number from a meta value (its JSON text). */
std::optional<double> parseMetaNumber(const MetaRows& meta, std::string_view key) {
  const auto row = meta.find(key);
  if (row == meta.end()) return std::nullopt;
  const Json value = Json::parse(row->second, nullptr, false);
  if (!core::isFiniteNumber(value)) return std::nullopt;
  return core::numberOf(value);
}

}  // namespace

StoreResult<Json> parseStoredJson(const std::string& text, std::string_view what) {
  Json value = Json::parse(text, nullptr, false);
  if (value.is_discarded()) return core::fail(sqlite::ioError(what, "invalid JSON in the file"));
  return value;
}

std::string metaNumber(double value) { return core::numberJson(value).dump(); }

StoreResult<MetaRows> readMeta(sqlite::Connection& connection) {
  auto select = sqlite::Statement::prepare(connection, "SELECT key, value FROM meta");
  if (!select) return core::fail(select.error());
  MetaRows rows;
  for (;;) {
    auto row = select->step();
    if (!row) return core::fail(row.error());
    if (!*row) return rows;
    rows.emplace(select->columnText(0), select->columnText(1));
  }
}

StoreResult<DocumentInfo> infoFromMeta(const MetaRows& meta) {
  const auto id = meta.find("document_id");
  const auto name = meta.find("name");
  const auto createdAt = parseMetaNumber(meta, "created_at");
  const auto updatedAt = parseMetaNumber(meta, "updated_at");
  const auto lastSeq = parseMetaNumber(meta, "last_seq");
  if (id == meta.end() || name == meta.end() || !createdAt || !updatedAt || !lastSeq) {
    return core::fail(sqlite::ioError("read meta", "missing or broken document metadata"));
  }
  DocumentInfo info;
  info.meta = DocumentMeta{DocumentId(id->second), name->second, *createdAt};
  info.lastSeq = static_cast<std::int64_t>(*lastSeq);
  info.updatedAt = *updatedAt;
  return info;
}

SqliteDocumentFile::SqliteDocumentFile(DocumentId id, sqlite::Connection connection, WallClock now)
    : id_(std::move(id)), connection_(std::move(connection)), now_(std::move(now)) {}

StoreResult<DocumentInfo> SqliteDocumentFile::info() {
  auto meta = readMeta(connection_);
  if (!meta) return core::fail(meta.error());
  return infoFromMeta(*meta);
}

StoreResult<std::int64_t> SqliteDocumentFile::lastSeq() {
  auto select = sqlite::Statement::prepare(connection_,
                                           "SELECT value FROM meta WHERE key = 'last_seq'");
  if (!select) return core::fail(select.error());
  auto row = select->step();
  if (!row) return core::fail(row.error());
  if (!*row) return core::fail(sqlite::ioError("read last_seq", "missing"));
  const Json value = Json::parse(select->columnText(0), nullptr, false);
  if (!core::isWholeNumber(value)) return core::fail(sqlite::ioError("read last_seq", "broken"));
  return static_cast<std::int64_t>(core::numberOf(value));
}

StoreResult<void> SqliteDocumentFile::setMeta(std::string_view key, std::string_view value) {
  auto upsert = sqlite::Statement::prepare(
      connection_, "INSERT INTO meta(key, value) VALUES(?1, ?2) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  if (!upsert) return core::fail(upsert.error());
  upsert->bind(1, key);
  upsert->bind(2, value);
  return upsert->run();
}

StoreResult<void> SqliteDocumentFile::appendEntries(std::span<const StoredEntry> entries) {
  if (entries.empty()) return {};
  for (const StoredEntry& entry : entries) {
    if (entry.seq < 1) {
      return core::fail(refused(StoreErrorCode::Invalid,
                                "seq must be >= 1, got " + std::to_string(entry.seq)));
    }
  }

  auto transaction = sqlite::SqliteTransaction::begin(connection_);
  if (!transaction) return core::fail(transaction.error());

  auto last = lastSeq();
  if (!last) return core::fail(last.error());
  for (std::size_t i = 0; i < entries.size(); ++i) {
    const std::int64_t expected = *last + 1 + static_cast<std::int64_t>(i);
    if (entries[i].seq != expected) {
      return core::fail(refused(StoreErrorCode::SeqGap,
                                "expected seq " + std::to_string(expected) + ", got " +
                                    std::to_string(entries[i].seq)));
    }
  }

  // Duplicates inside the batch and against the stored entries (the unique index, N34).
  auto findStored = sqlite::Statement::prepare(connection_,
                                               "SELECT 1 FROM operations WHERE operation_id = ?1");
  if (!findStored) return core::fail(findStored.error());
  std::set<std::string, std::less<>> seen;
  for (const StoredEntry& entry : entries) {
    if (!entry.operation) continue;
    const std::string& operationId = entry.operation->id;
    findStored->reset();
    findStored->bind(1, operationId);
    auto found = findStored->step();
    if (!found) return core::fail(found.error());
    if (*found || !seen.insert(operationId).second) {
      return core::fail(refused(StoreErrorCode::DuplicateOperation,
                                "operation id '" + operationId + "' is already stored"));
    }
  }

  auto insert = sqlite::Statement::prepare(
      connection_,
      "INSERT INTO operations(seq, operation_id, fingerprint, entry) VALUES(?1, ?2, ?3, ?4)");
  if (!insert) return core::fail(insert.error());
  for (const StoredEntry& entry : entries) {
    insert->reset();
    insert->bind(1, entry.seq);
    if (entry.operation) {
      insert->bind(2, entry.operation->id);
      insert->bind(3, entry.operation->fingerprint);
    } else {
      insert->bindNull(2);
      insert->bindNull(3);
    }
    insert->bind(4, entry.entry.dump());
    auto inserted = insert->run();
    if (!inserted) return inserted;
  }

  auto setLast = setMeta("last_seq", std::to_string(entries.back().seq));
  if (!setLast) return setLast;
  auto setUpdated = setMeta("updated_at", metaNumber(now_()));
  if (!setUpdated) return setUpdated;
  if (const auto name = renamedTo(entries)) {
    auto setName = setMeta("name", *name);
    if (!setName) return setName;
  }
  return transaction->commit();
}

StoreResult<void> SqliteDocumentFile::saveSnapshot(std::int64_t atSeq, const Json& snapshot) {
  if (atSeq < 1) {
    return core::fail(refused(StoreErrorCode::Invalid,
                              "atSeq must be >= 1, got " + std::to_string(atSeq)));
  }
  const Json* metaId = nullptr;
  if (snapshot.is_object() && snapshot.contains("document") && snapshot["document"].is_object() &&
      snapshot["document"].contains("meta") && snapshot["document"]["meta"].is_object() &&
      snapshot["document"]["meta"].contains("id")) {
    metaId = &snapshot["document"]["meta"]["id"];
  }
  if (metaId == nullptr || !metaId->is_string() || metaId->get<std::string>() != id_.str()) {
    return core::fail(refused(StoreErrorCode::Invalid,
                              "the snapshot belongs to another document than '" + id_.str() + "'"));
  }

  auto transaction = sqlite::SqliteTransaction::begin(connection_);
  if (!transaction) return core::fail(transaction.error());
  auto last = lastSeq();
  if (!last) return core::fail(last.error());
  if (atSeq > *last) {
    return core::fail(refused(StoreErrorCode::SnapshotAhead,
                              "atSeq " + std::to_string(atSeq) + " is beyond lastSeq " +
                                  std::to_string(*last)));
  }

  auto upsert = sqlite::Statement::prepare(
      connection_, "INSERT INTO snapshots(at_seq, snapshot) VALUES(?1, ?2) "
                   "ON CONFLICT(at_seq) DO UPDATE SET snapshot = excluded.snapshot");
  if (!upsert) return core::fail(upsert.error());
  upsert->bind(1, atSeq);
  upsert->bind(2, snapshot.dump());
  auto saved = upsert->run();
  if (!saved) return saved;

  auto pruned = pruneSnapshots();
  if (!pruned) return pruned;
  return transaction->commit();
}

StoreResult<void> SqliteDocumentFile::pruneSnapshots() {
  auto select = sqlite::Statement::prepare(connection_, "SELECT at_seq FROM snapshots");
  if (!select) return core::fail(select.error());
  std::vector<std::int64_t> atSeqs;
  for (;;) {
    auto row = select->step();
    if (!row) return core::fail(row.error());
    if (!*row) break;
    atSeqs.push_back(select->columnInt(0));
  }
  const std::vector<std::int64_t> keep = snapshotSeqsToKeep(atSeqs);

  auto remove = sqlite::Statement::prepare(connection_, "DELETE FROM snapshots WHERE at_seq = ?1");
  if (!remove) return core::fail(remove.error());
  for (const std::int64_t atSeq : atSeqs) {
    if (std::ranges::find(keep, atSeq) != keep.end()) continue;
    remove->reset();
    remove->bind(1, atSeq);
    auto removed = remove->run();
    if (!removed) return removed;
  }
  return {};
}

StoreResult<Json> SqliteDocumentFile::readSnapshot(std::string_view sql) {
  auto select = sqlite::Statement::prepare(connection_, sql);
  if (!select) return core::fail(select.error());
  auto row = select->step();
  if (!row) return core::fail(row.error());
  if (!*row) return core::fail(sqlite::ioError("load", "the document has no base snapshot"));
  return parseStoredJson(select->columnText(0), "load snapshot");
}

StoreResult<StoredDocument> SqliteDocumentFile::load() {
  // One read transaction: the snapshots and the entries are one consistent state.
  auto transaction = connection_.exec("BEGIN");
  if (!transaction) return core::fail(transaction.error());
  struct EndRead {
    sqlite::Connection& connection;
    ~EndRead() { (void)connection.exec("COMMIT"); }
  } endRead{connection_};

  StoredDocument stored;
  auto latest = readSnapshot("SELECT snapshot FROM snapshots ORDER BY at_seq DESC LIMIT 1");
  if (!latest) return core::fail(latest.error());
  auto base = readSnapshot("SELECT snapshot FROM snapshots WHERE at_seq = 0");
  if (!base) return core::fail(base.error());
  stored.snapshot = std::move(*latest);
  stored.base = std::move(*base);

  auto select = sqlite::Statement::prepare(
      connection_, "SELECT seq, operation_id, fingerprint, entry FROM operations ORDER BY seq");
  if (!select) return core::fail(select.error());
  for (;;) {
    auto row = select->step();
    if (!row) return core::fail(row.error());
    if (!*row) break;
    StoredEntry entry;
    entry.seq = select->columnInt(0);
    if (!select->columnIsNull(1)) {
      entry.operation = OperationKey{select->columnText(1), select->columnText(2)};
    }
    auto json = parseStoredJson(select->columnText(3), "load entry");
    if (!json) return core::fail(json.error());
    entry.entry = std::move(*json);
    stored.entries.push_back(std::move(entry));
  }
  return stored;
}

StoreResult<std::optional<StoredEntry>> SqliteDocumentFile::findEntry(std::string_view operationId) {
  auto select = sqlite::Statement::prepare(
      connection_, "SELECT seq, fingerprint, entry FROM operations WHERE operation_id = ?1");
  if (!select) return core::fail(select.error());
  select->bind(1, operationId);
  auto row = select->step();
  if (!row) return core::fail(row.error());
  if (!*row) return std::optional<StoredEntry>();
  StoredEntry entry;
  entry.seq = select->columnInt(0);
  entry.operation = OperationKey{std::string(operationId), select->columnText(1)};
  auto json = parseStoredJson(select->columnText(2), "find entry");
  if (!json) return core::fail(json.error());
  entry.entry = std::move(*json);
  return std::optional<StoredEntry>(std::move(entry));
}

}  // namespace tinycad::storage
