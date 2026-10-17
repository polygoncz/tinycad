#include "schema.hpp"

#include <string>

namespace tinycad::storage::schema {

StoreResult<void> configure(sqlite::Connection& connection) {
  // journal_mode returns a row; exec ignores it. WAL is persistent in the file, setting it again
  // is a no-op.
  for (const char* pragma : {"PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL",
                             "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000"}) {
    auto done = connection.exec(pragma);
    if (!done) return done;
  }
  return {};
}

StoreResult<void> createTables(sqlite::Connection& connection) {
  static const std::string sql =
      "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
      "CREATE TABLE operations(seq INTEGER PRIMARY KEY, operation_id TEXT UNIQUE, "
      "fingerprint TEXT, entry TEXT NOT NULL);"
      "CREATE TABLE snapshots(at_seq INTEGER PRIMARY KEY, snapshot TEXT NOT NULL);"
      "PRAGMA user_version=" +
      std::to_string(FORMAT_VERSION) + ";";
  return connection.exec(sql);
}

StoreResult<void> checkFormat(sqlite::Connection& connection) {
  auto version = sqlite::Statement::prepare(connection, "PRAGMA user_version");
  if (!version) return core::fail(version.error());
  auto row = version->step();
  if (!row) return core::fail(row.error());
  if (!*row || version->columnInt(0) != FORMAT_VERSION) {
    return core::fail(sqlite::ioError("check format", "unsupported format (user_version)"));
  }

  auto format = sqlite::Statement::prepare(connection, "SELECT value FROM meta WHERE key = 'format'");
  if (!format) return core::fail(format.error());
  auto formatRow = format->step();
  if (!formatRow) return core::fail(formatRow.error());
  if (!*formatRow || format->columnText(0) != FORMAT_NAME) {
    return core::fail(sqlite::ioError("check format", "unsupported format (meta.format)"));
  }
  return {};
}

}  // namespace tinycad::storage::schema
