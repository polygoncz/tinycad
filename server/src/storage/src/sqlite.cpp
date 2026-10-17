#include "sqlite.hpp"

#include <sqlite3.h>

#include <utility>

namespace tinycad::storage::sqlite {

StoreError ioError(std::string_view context, std::string_view message) {
  std::string text(context);
  text += ": ";
  text += message;
  return StoreError{StoreErrorCode::Io, std::move(text)};
}

// --- Connection ---------------------------------------------------------------------------

StoreResult<Connection> Connection::open(const std::filesystem::path& path, bool create) {
  sqlite3* db = nullptr;
  const int flags = SQLITE_OPEN_READWRITE | (create ? SQLITE_OPEN_CREATE : 0);
  const int rc = sqlite3_open_v2(path.c_str(), &db, flags, nullptr);
  // sqlite3_open_v2 returns a handle even on failure (except out of memory); it must be closed.
  Connection connection(db);
  if (rc != SQLITE_OK) {
    return core::fail(ioError("open " + path.string(),
                              db != nullptr ? sqlite3_errmsg(db) : sqlite3_errstr(rc)));
  }
  sqlite3_busy_timeout(db, 5000);
  auto foreignKeys = connection.exec("PRAGMA foreign_keys=ON");
  if (!foreignKeys) return core::fail(foreignKeys.error());
  return connection;
}

Connection::Connection(Connection&& other) noexcept : db_(std::exchange(other.db_, nullptr)) {}

Connection& Connection::operator=(Connection&& other) noexcept {
  if (this != &other) {
    if (db_ != nullptr) sqlite3_close_v2(db_);
    db_ = std::exchange(other.db_, nullptr);
  }
  return *this;
}

Connection::~Connection() {
  if (db_ != nullptr) sqlite3_close_v2(db_);
}

StoreResult<void> Connection::exec(const std::string& sql) {
  char* message = nullptr;
  const int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &message);
  if (rc == SQLITE_OK) return {};
  StoreError error = ioError(sql, message != nullptr ? message : sqlite3_errstr(rc));
  sqlite3_free(message);
  return core::fail(std::move(error));
}

StoreError Connection::error(std::string_view context) const {
  return ioError(context, sqlite3_errmsg(db_));
}

// --- Statement ----------------------------------------------------------------------------

StoreResult<Statement> Statement::prepare(Connection& connection, std::string_view sql) {
  sqlite3_stmt* statement = nullptr;
  const int rc = sqlite3_prepare_v2(connection.handle(), sql.data(), static_cast<int>(sql.size()),
                                    &statement, nullptr);
  if (rc != SQLITE_OK) {
    sqlite3_finalize(statement);
    return core::fail(connection.error(sql));
  }
  return Statement(statement, connection.handle());
}

Statement::Statement(Statement&& other) noexcept
    : statement_(std::exchange(other.statement_, nullptr)),
      db_(other.db_),
      bindError_(other.bindError_) {}

Statement& Statement::operator=(Statement&& other) noexcept {
  if (this != &other) {
    sqlite3_finalize(statement_);
    statement_ = std::exchange(other.statement_, nullptr);
    db_ = other.db_;
    bindError_ = other.bindError_;
  }
  return *this;
}

Statement::~Statement() { sqlite3_finalize(statement_); }

void Statement::remember(int rc) {
  if (rc != SQLITE_OK && bindError_ == 0) bindError_ = rc;
}

void Statement::bind(int index, std::int64_t value) {
  remember(sqlite3_bind_int64(statement_, index, value));
}

void Statement::bind(int index, std::string_view text) {
  remember(sqlite3_bind_text(statement_, index, text.data(), static_cast<int>(text.size()),
                             SQLITE_TRANSIENT));
}

void Statement::bindNull(int index) { remember(sqlite3_bind_null(statement_, index)); }

StoreResult<bool> Statement::step() {
  if (bindError_ != 0) return core::fail(ioError(sqlite3_sql(statement_), sqlite3_errstr(bindError_)));
  const int rc = sqlite3_step(statement_);
  if (rc == SQLITE_ROW) return true;
  if (rc == SQLITE_DONE) return false;
  return core::fail(ioError(sqlite3_sql(statement_), sqlite3_errmsg(db_)));
}

StoreResult<void> Statement::run() {
  for (;;) {
    auto row = step();
    if (!row) return core::fail(row.error());
    if (!*row) return {};
  }
}

void Statement::reset() {
  sqlite3_reset(statement_);
  sqlite3_clear_bindings(statement_);
  bindError_ = 0;
}

std::int64_t Statement::columnInt(int index) const {
  return sqlite3_column_int64(statement_, index);
}

std::string Statement::columnText(int index) const {
  const unsigned char* text = sqlite3_column_text(statement_, index);
  if (text == nullptr) return {};
  // SQLite text is UTF-8 bytes; the length comes from sqlite3_column_bytes (may contain NUL).
  return std::string(reinterpret_cast<const char*>(text),
                     static_cast<std::size_t>(sqlite3_column_bytes(statement_, index)));
}

bool Statement::columnIsNull(int index) const {
  return sqlite3_column_type(statement_, index) == SQLITE_NULL;
}

// --- SqliteTransaction --------------------------------------------------------------------

StoreResult<SqliteTransaction> SqliteTransaction::begin(Connection& connection) {
  auto begun = connection.exec("BEGIN IMMEDIATE");
  if (!begun) return core::fail(begun.error());
  return SqliteTransaction(connection);
}

SqliteTransaction::SqliteTransaction(SqliteTransaction&& other) noexcept
    : connection_(std::exchange(other.connection_, nullptr)) {}

SqliteTransaction::~SqliteTransaction() {
  // A rollback failure cannot be reported from a destructor; SQLite rolls back on close anyway.
  if (connection_ != nullptr) (void)connection_->exec("ROLLBACK");
}

StoreResult<void> SqliteTransaction::commit() {
  auto committed = connection_->exec("COMMIT");
  if (!committed) return committed;
  connection_ = nullptr;
  return {};
}

}  // namespace tinycad::storage::sqlite
