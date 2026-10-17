#include "sqlite_catalog.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <system_error>
#include <utility>

#include "schema.hpp"
#include "sqlite.hpp"
#include "sqlite_document_file.hpp"

namespace tinycad::storage {

namespace {

constexpr std::string_view FILE_SUFFIX = ".tinycad.sqlite";
constexpr std::size_t MAX_ID_LENGTH = 64;

StoreError ioError(std::string_view context, const std::error_code& error) {
  return sqlite::ioError(context, error.message());
}

/** Removes a file; a missing one is fine. */
StoreResult<void> removeFile(const std::filesystem::path& path) {
  std::error_code error;
  std::filesystem::remove(path, error);
  if (error) return core::fail(ioError("remove " + path.string(), error));
  return {};
}

/** The file and the side files SQLite may leave next to it (WAL, shared memory, journal). */
StoreResult<void> removeWithSideFiles(const std::filesystem::path& path) {
  for (const char* suffix : {"", "-wal", "-shm", "-journal"}) {
    auto removed = removeFile(path.string() + suffix);
    if (!removed) return removed;
  }
  return {};
}

/**
 * Makes a rename in the directory durable (POSIX: the directory entry is data of the directory).
 * Best effort: a failure here does not undo the created document.
 */
void syncDirectory(const std::filesystem::path& directory) {
  const int fd = ::open(directory.c_str(), O_RDONLY);
  if (fd < 0) return;
  (void)::fsync(fd);
  ::close(fd);
}

/** The initial snapshot must be the base one (atSeq 0) of the same document (spec 05). */
bool isBaseOf(const Json& snapshot, const DocumentId& id) {
  if (!snapshot.is_object()) return false;
  const auto atSeq = snapshot.find("atSeq");
  if (atSeq == snapshot.end() || !core::isFiniteNumber(*atSeq) || core::numberOf(*atSeq) != 0) {
    return false;
  }
  const auto document = snapshot.find("document");
  if (document == snapshot.end() || !document->is_object()) return false;
  const auto meta = document->find("meta");
  if (meta == document->end() || !meta->is_object()) return false;
  const auto metaId = meta->find("id");
  return metaId != meta->end() && metaId->is_string() && metaId->get<std::string>() == id.str();
}

/** The meta rows and the base snapshot of a new file, in one transaction. */
StoreResult<void> writeNewFile(sqlite::Connection& connection, const DocumentMeta& meta,
                               const Json& initialSnapshot,
                               const std::optional<OperationKey>& createdBy, double now) {
  auto created = schema::createTables(connection);
  if (!created) return created;

  auto transaction = sqlite::SqliteTransaction::begin(connection);
  if (!transaction) return core::fail(transaction.error());

  auto insertMeta =
      sqlite::Statement::prepare(connection, "INSERT INTO meta(key, value) VALUES(?1, ?2)");
  if (!insertMeta) return core::fail(insertMeta.error());
  std::vector<std::pair<std::string_view, std::string>> rows = {
      {"format", std::string(schema::FORMAT_NAME)},
      {"document_id", meta.id.str()},
      {"name", meta.name},
      {"created_at", metaNumber(meta.createdAt)},
      {"updated_at", metaNumber(now)},
      {"last_seq", "0"},
  };
  if (createdBy) {
    rows.emplace_back("created_by_operation", createdBy->id);
    rows.emplace_back("created_by_fingerprint", createdBy->fingerprint);
  }
  for (const auto& [key, value] : rows) {
    insertMeta->reset();
    insertMeta->bind(1, key);
    insertMeta->bind(2, value);
    auto inserted = insertMeta->run();
    if (!inserted) return inserted;
  }

  auto insertSnapshot = sqlite::Statement::prepare(
      connection, "INSERT INTO snapshots(at_seq, snapshot) VALUES(0, ?1)");
  if (!insertSnapshot) return core::fail(insertSnapshot.error());
  insertSnapshot->bind(1, initialSnapshot.dump());
  auto inserted = insertSnapshot->run();
  if (!inserted) return inserted;
  return transaction->commit();
}

}  // namespace

bool isSafeDocumentId(std::string_view id) {
  if (id.empty() || id.size() > MAX_ID_LENGTH) return false;
  return std::ranges::all_of(id, [](char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
           c == '_' || c == '-';
  });
}

std::unique_ptr<DocumentCatalog> openSqliteCatalog(std::filesystem::path directory, WallClock now) {
  return std::make_unique<SqliteDocumentCatalog>(std::move(directory), std::move(now));
}

SqliteDocumentCatalog::SqliteDocumentCatalog(std::filesystem::path directory, WallClock now)
    : directory_(std::move(directory)), now_(std::move(now)) {
  // A failure shows up as Io on the first call that needs the directory.
  std::error_code ignored;
  std::filesystem::create_directories(directory_, ignored);
}

std::filesystem::path SqliteDocumentCatalog::pathOf(const DocumentId& id) const {
  return directory_ / (id.str() + std::string(FILE_SUFFIX));
}

StoreResult<std::vector<DocumentId>> SqliteDocumentCatalog::storedIds() const {
  std::vector<DocumentId> ids;
  std::error_code error;
  std::filesystem::directory_iterator it(directory_, error);
  if (error) return core::fail(ioError("list " + directory_.string(), error));
  for (const auto& entry : it) {
    const std::string name = entry.path().filename().string();
    if (!name.ends_with(FILE_SUFFIX)) continue;
    const std::string id = name.substr(0, name.size() - FILE_SUFFIX.size());
    if (isSafeDocumentId(id)) ids.emplace_back(id);
  }
  return ids;
}

StoreResult<std::vector<DocumentInfo>> SqliteDocumentCatalog::list() {
  auto ids = storedIds();
  if (!ids) return core::fail(ids.error());
  std::vector<DocumentInfo> infos;
  for (const DocumentId& id : *ids) {
    auto file = open(id);
    if (!file) continue;  // an unreadable file is skipped
    auto info = (*file)->info();
    if (info) infos.push_back(std::move(*info));
  }
  // Newest first; the id breaks ties so the order is deterministic.
  std::ranges::sort(infos, [](const DocumentInfo& a, const DocumentInfo& b) {
    if (a.updatedAt != b.updatedAt) return a.updatedAt > b.updatedAt;
    return a.meta.id < b.meta.id;
  });
  return infos;
}

StoreResult<std::unique_ptr<DocumentFile>> SqliteDocumentCatalog::create(
    const DocumentMeta& meta, const Json& initialSnapshot,
    const std::optional<OperationKey>& createdBy) {
  if (!isSafeDocumentId(meta.id.str())) {
    return core::fail(StoreError{StoreErrorCode::Invalid,
                                 "document id '" + meta.id.str() + "' is not [A-Za-z0-9_-]{1,64}"});
  }
  const std::filesystem::path path = pathOf(meta.id);
  std::error_code error;
  const bool exists = std::filesystem::exists(path, error);
  if (error) return core::fail(ioError("create " + path.string(), error));
  if (exists) {
    return core::fail(StoreError{StoreErrorCode::AlreadyExists,
                                 "document '" + meta.id.str() + "' already exists"});
  }
  if (!isBaseOf(initialSnapshot, meta.id)) {
    return core::fail(StoreError{StoreErrorCode::Invalid,
                                 "the initial snapshot must have atSeq 0 and meta.id '" +
                                     meta.id.str() + "'"});
  }

  // Written under a temporary name and renamed: a crash leaves no half document (N39). The
  // temporary file uses the rollback journal, so it is complete in one file before the rename.
  const std::filesystem::path temporary = path.string() + ".tmp";
  auto cleaned = removeWithSideFiles(temporary);
  if (!cleaned) return core::fail(cleaned.error());
  {
    auto connection = sqlite::Connection::open(temporary, true);
    if (!connection) return core::fail(connection.error());
    auto synchronous = connection->exec("PRAGMA synchronous=FULL");
    if (!synchronous) return core::fail(synchronous.error());
    auto written = writeNewFile(*connection, meta, initialSnapshot, createdBy, now_());
    if (!written) {
      (void)removeWithSideFiles(temporary);
      return core::fail(written.error());
    }
  }
  std::filesystem::rename(temporary, path, error);
  if (error) {
    (void)removeWithSideFiles(temporary);
    return core::fail(ioError("create " + path.string(), error));
  }
  syncDirectory(directory_);
  return open(meta.id);
}

StoreResult<std::unique_ptr<DocumentFile>> SqliteDocumentCatalog::open(const DocumentId& id) {
  const StoreError notFound{StoreErrorCode::NotFound, "no document '" + id.str() + "'"};
  if (!isSafeDocumentId(id.str())) return core::fail(notFound);
  const std::filesystem::path path = pathOf(id);
  std::error_code error;
  const bool exists = std::filesystem::exists(path, error);
  if (error) return core::fail(ioError("open " + path.string(), error));
  if (!exists) return core::fail(notFound);

  auto connection = sqlite::Connection::open(path, false);
  if (!connection) return core::fail(connection.error());
  // The format first, so a foreign file is not switched to WAL.
  auto format = schema::checkFormat(*connection);
  if (!format) return core::fail(format.error());
  auto configured = schema::configure(*connection);
  if (!configured) return core::fail(configured.error());
  auto meta = readMeta(*connection);
  if (!meta) return core::fail(meta.error());
  const auto documentId = meta->find("document_id");
  if (documentId == meta->end() || documentId->second != id.str()) {
    return core::fail(sqlite::ioError("open " + path.string(),
                                      "the file belongs to another document id"));
  }
  return std::unique_ptr<DocumentFile>(
      std::make_unique<SqliteDocumentFile>(id, std::move(*connection), now_));
}

StoreResult<void> SqliteDocumentCatalog::remove(const DocumentId& id) {
  if (!isSafeDocumentId(id.str())) {
    return core::fail(StoreError{StoreErrorCode::NotFound, "no document '" + id.str() + "'"});
  }
  return removeWithSideFiles(pathOf(id));
}

StoreResult<std::optional<std::pair<DocumentId, OperationKey>>> SqliteDocumentCatalog::findCreated(
    std::string_view operationId) {
  using Found = std::optional<std::pair<DocumentId, OperationKey>>;
  auto ids = storedIds();
  if (!ids) return core::fail(ids.error());
  for (const DocumentId& id : *ids) {
    auto connection = sqlite::Connection::open(pathOf(id), false);
    if (!connection) continue;  // unreadable files are skipped, as in list
    auto meta = readMeta(*connection);
    if (!meta) continue;
    const auto operation = meta->find("created_by_operation");
    const auto fingerprint = meta->find("created_by_fingerprint");
    if (operation == meta->end() || operation->second != operationId) continue;
    std::string print = fingerprint != meta->end() ? fingerprint->second : std::string();
    return Found(std::pair{id, OperationKey{operation->second, std::move(print)}});
  }
  return Found();
}

}  // namespace tinycad::storage
