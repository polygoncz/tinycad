#pragma once

// DocumentFile over one SQLite file (decision N32): one connection in WAL mode, every method one
// SQLite transaction that checks the contract of store.hpp before it writes.

#include <map>
#include <string>

#include "sqlite.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

/** The rows of the meta table (key → value). */
using MetaRows = std::map<std::string, std::string, std::less<>>;

/** Reads the whole meta table. */
StoreResult<MetaRows> readMeta(sqlite::Connection& connection);

/** DocumentInfo from the meta rows; Io when a row is missing or broken. */
StoreResult<DocumentInfo> infoFromMeta(const MetaRows& meta);

/** A number as the text stored in meta (its JSON, core::numberJson). */
std::string metaNumber(double value);

class SqliteDocumentFile final : public DocumentFile {
 public:
  /** `connection` is an open, configured document file whose format was checked. */
  SqliteDocumentFile(DocumentId id, sqlite::Connection connection, WallClock now);

  [[nodiscard]] const DocumentId& id() const override { return id_; }
  StoreResult<DocumentInfo> info() override;
  StoreResult<void> appendEntries(std::span<const StoredEntry> entries) override;
  StoreResult<void> saveSnapshot(std::int64_t atSeq, const Json& snapshot) override;
  StoreResult<StoredDocument> load() override;
  StoreResult<std::optional<StoredEntry>> findEntry(std::string_view operationId) override;

 private:
  /** meta.last_seq inside the current transaction. */
  StoreResult<std::int64_t> lastSeq();
  StoreResult<void> setMeta(std::string_view key, std::string_view value);
  /** Deletes every snapshot snapshotSeqsToKeep does not keep (Q009). */
  StoreResult<void> pruneSnapshots();
  /** The snapshot JSON of the row with the given at_seq query ('… ORDER BY at_seq DESC'). */
  StoreResult<Json> readSnapshot(std::string_view sql);

  DocumentId id_;
  sqlite::Connection connection_;
  WallClock now_;
};

/** JSON text from the file; invalid JSON is Io (a corrupt file). */
StoreResult<Json> parseStoredJson(const std::string& text, std::string_view what);

}  // namespace tinycad::storage
