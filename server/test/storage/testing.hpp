#pragma once

// Test helpers of storage: a unique temporary directory, snapshot and entry JSON, the schema and
// handler registries of the server (built-in schemas), reading the tables of a file directly and
// spawning a helper process. Test-only.

#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>

#include <gtest/gtest.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include "document/testing.hpp"
#include "snapshot.hpp"
#include "sqlite.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/storage/store.hpp"

extern char** environ;

namespace tinycad::testing {

using core::Json;
using storage::OperationKey;
using storage::StoredEntry;

/** A unique empty directory under the system temp directory, removed with everything in it. */
class TempDir {
 public:
  TempDir() {
    std::random_device random;
    std::uniform_int_distribution<std::uint64_t> any;
    path_ = std::filesystem::temp_directory_path() /
            ("tinycad-storage-" + std::to_string(any(random)));
    std::filesystem::create_directories(path_);
  }
  ~TempDir() {
    std::error_code ignored;
    std::filesystem::remove_all(path_, ignored);
  }
  TempDir(const TempDir&) = delete;
  TempDir& operator=(const TempDir&) = delete;

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }

 private:
  std::filesystem::path path_;
};

/** A clock the test sets by hand (the store never reads real time in tests). */
struct ManualClock {
  double time = 1000;
  storage::WallClock clock() {
    return [this] { return time; };
  }
};

inline document::DocumentMeta metaOf(const std::string& id) {
  return {document::DocumentId(id), "Doc " + id, 0};
}

/** A snapshot JSON of document `id` with one feature 'a' named `name`. */
inline Json aSnapshotJson(const std::string& id, std::int64_t atSeq,
                          const std::string& name = "A") {
  auto doc = aDocument({.id = id,
                        .name = "Doc " + id,
                        .features = {aFeature({.id = "a", .name = name})}});
  return storage::snapshotJson(*doc, atSeq);
}

/** A LogEntry JSON { seq, kind 'do', op, inverse = op, label = op.type, time 0 }. */
inline Json anEntryJson(std::int64_t seq, const Json& op) {
  return {{"seq", seq},     {"kind", "do"}, {"op", op},
          {"inverse", op},  {"label", op.value("type", std::string())},
          {"time", 0}};
}

inline Json featureRenameOp(const std::string& name, const std::string& featureId = "a") {
  return {{"type", "feature.rename"}, {"v", 1}, {"featureId", featureId}, {"name", name}};
}

inline Json documentRenameOp(const std::string& name) {
  return {{"type", "document.rename"}, {"v", 1}, {"name", name}};
}

/** A stored entry of a feature rename, optionally with an operation key. */
inline StoredEntry anEntry(std::int64_t seq, std::optional<OperationKey> key = std::nullopt,
                           const Json& op = Json()) {
  return StoredEntry{seq, std::move(key),
                     anEntryJson(seq, op.is_null() ? featureRenameOp("A" + std::to_string(seq)) : op)};
}

/** The schema registry of the server: the built-in schemas (M40). */
inline const document::FeatureSchemaRegistry& serverSchemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

inline const ops::OpHandlerRegistry& serverHandlers() {
  static const ops::OpHandlerRegistry handlers(serverSchemas());
  return handlers;
}

/** Rows of one integer column of a file, read directly with SQLite (no store code). */
inline std::vector<std::int64_t> integerColumn(const std::filesystem::path& file,
                                               const std::string& sql) {
  auto connection = storage::sqlite::Connection::open(file, false);
  EXPECT_TRUE(connection.has_value());
  if (!connection) return {};
  auto select = storage::sqlite::Statement::prepare(*connection, sql);
  EXPECT_TRUE(select.has_value());
  if (!select) return {};
  std::vector<std::int64_t> values;
  for (auto row = select->step(); row && *row; row = select->step()) {
    values.push_back(select->columnInt(0));
  }
  return values;
}

/** One text value of a file, read directly ('' when there is no row). */
inline std::string textValue(const std::filesystem::path& file, const std::string& sql) {
  auto connection = storage::sqlite::Connection::open(file, false);
  if (!connection) return {};
  auto select = storage::sqlite::Statement::prepare(*connection, sql);
  if (!select) return {};
  auto row = select->step();
  return row && *row ? select->columnText(0) : std::string();
}

/** The result of a helper process. */
struct ProcessResult {
  int status = 0;
  std::string out;
};

/** Runs `program` with `args`, its stdout into `outFile`, and waits for it (posix_spawn). */
inline ProcessResult runProcess(const std::string& program, const std::vector<std::string>& args,
                                const std::filesystem::path& outFile) {
  std::vector<std::string> all = {program};
  all.insert(all.end(), args.begin(), args.end());
  std::vector<char*> argv;
  for (std::string& arg : all) argv.push_back(arg.data());
  argv.push_back(nullptr);

  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, 1, outFile.c_str(), O_WRONLY | O_CREAT | O_TRUNC,
                                   0644);
  pid_t pid = 0;
  const int spawned = posix_spawn(&pid, program.c_str(), &actions, nullptr, argv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  EXPECT_EQ(spawned, 0) << "cannot spawn " << program;
  ProcessResult result;
  if (spawned != 0) return result;
  waitpid(pid, &result.status, 0);
  std::ifstream in(outFile);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  result.out = buffer.str();
  return result;
}

}  // namespace tinycad::testing
