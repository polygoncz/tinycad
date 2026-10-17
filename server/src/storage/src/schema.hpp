#pragma once

// The layout of a document file '<id>.tinycad.sqlite' (decision N32), internal to
// tinycad_storage:
//
//   meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
//     format = 'tinycad.sqlite', document_id, name, created_at, updated_at, last_seq and, for a
//     document created by a request, created_by_operation and created_by_fingerprint (N39).
//     Numbers are stored as their JSON text (core::numberJson), so a double round-trips exactly.
//   operations(seq INTEGER PRIMARY KEY, operation_id TEXT UNIQUE, fingerprint TEXT,
//              entry TEXT NOT NULL)
//     operation_id is NULL for entries without a request (imported history).
//   snapshots(at_seq INTEGER PRIMARY KEY, snapshot TEXT NOT NULL)
//
// PRAGMA user_version 1; another version is refused as an unsupported format.

#include "sqlite.hpp"

namespace tinycad::storage::schema {

/** The value of PRAGMA user_version of the current layout. */
inline constexpr int FORMAT_VERSION = 1;
/** The value of meta.format. */
inline constexpr std::string_view FORMAT_NAME = "tinycad.sqlite";

/**
 * Durable settings of an open document: WAL journal, synchronous FULL (every commit reaches the
 * disk before it returns, "saved = answered"), foreign keys and a busy timeout.
 */
StoreResult<void> configure(sqlite::Connection& connection);

/** Creates the three tables and sets user_version, in a new empty file (rollback journal). */
StoreResult<void> createTables(sqlite::Connection& connection);

/** Io "unsupported format" unless user_version is FORMAT_VERSION and meta.format matches. */
StoreResult<void> checkFormat(sqlite::Connection& connection);

}  // namespace tinycad::storage::schema
