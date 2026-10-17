#pragma once

// Thin RAII wrappers over the SQLite C API (internal to tinycad_storage): a connection, a
// prepared statement and a transaction. No ORM and no templates over SQL (N9): the SQL stays a
// constant string next to the method that runs it. Every SQLite failure becomes StoreError{Io}
// with the text of sqlite3_errmsg.

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

#include "tinycad/storage/store.hpp"

struct sqlite3;
struct sqlite3_stmt;

namespace tinycad::storage::sqlite {

/** StoreError{Io} "<context>: <message>". */
StoreError ioError(std::string_view context, std::string_view message);

/** One open database file; closes it on destruction. Move-only. */
class Connection {
 public:
  /**
   * Opens the file read-write; with `create` a missing file is created, without it a missing
   * file is an Io error. Sets busy_timeout (5000 ms) and foreign_keys.
   */
  static StoreResult<Connection> open(const std::filesystem::path& path, bool create);

  Connection(Connection&& other) noexcept;
  Connection& operator=(Connection&& other) noexcept;
  Connection(const Connection&) = delete;
  Connection& operator=(const Connection&) = delete;
  ~Connection();

  /** Runs SQL without parameters or results (PRAGMA, CREATE TABLE). */
  StoreResult<void> exec(const std::string& sql);

  /** Io error with the last message of this connection. */
  [[nodiscard]] StoreError error(std::string_view context) const;

  [[nodiscard]] sqlite3* handle() const { return db_; }

 private:
  explicit Connection(sqlite3* db) : db_(db) {}
  sqlite3* db_ = nullptr;
};

/**
 * One prepared statement. Parameters are 1-based like in SQLite; a failing bind is remembered and
 * reported by the next step(), so callers check once.
 */
class Statement {
 public:
  static StoreResult<Statement> prepare(Connection& connection, std::string_view sql);

  Statement(Statement&& other) noexcept;
  Statement& operator=(Statement&& other) noexcept;
  Statement(const Statement&) = delete;
  Statement& operator=(const Statement&) = delete;
  ~Statement();

  void bind(int index, std::int64_t value);
  void bind(int index, std::string_view text);
  void bindNull(int index);

  /** True when a row is available, false when done. */
  StoreResult<bool> step();
  /** Runs a statement without result rows to its end. */
  StoreResult<void> run();
  /** For a statement run again with other parameters. */
  void reset();

  [[nodiscard]] std::int64_t columnInt(int index) const;
  [[nodiscard]] std::string columnText(int index) const;
  [[nodiscard]] bool columnIsNull(int index) const;

 private:
  Statement(sqlite3_stmt* statement, sqlite3* db) : statement_(statement), db_(db) {}
  void remember(int rc);

  sqlite3_stmt* statement_ = nullptr;
  sqlite3* db_ = nullptr;
  int bindError_ = 0;
};

/**
 * BEGIN IMMEDIATE on construction (the write lock is taken at once, so the checks read inside the
 * transaction cannot be overtaken); commit() makes it durable, destruction without commit rolls
 * it back. Move-only.
 */
class SqliteTransaction {
 public:
  static StoreResult<SqliteTransaction> begin(Connection& connection);

  SqliteTransaction(SqliteTransaction&& other) noexcept;
  SqliteTransaction& operator=(SqliteTransaction&&) = delete;
  SqliteTransaction(const SqliteTransaction&) = delete;
  SqliteTransaction& operator=(const SqliteTransaction&) = delete;
  ~SqliteTransaction();

  StoreResult<void> commit();

 private:
  explicit SqliteTransaction(Connection& connection) : connection_(&connection) {}
  /** nullptr after commit or a move: nothing to roll back. */
  Connection* connection_ = nullptr;
};

}  // namespace tinycad::storage::sqlite
