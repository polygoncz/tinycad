// tinycad-import: imports documents exported from the browser (`.tinycad.json`, with or without
// history) into the SQLite document catalog of the native core (M41, decision N38).
//
//   tinycad-import [--data-dir DIR] <file.tinycad.json | directory>...
//
// A directory means every '*.tinycad.json' directly in it (not recursive). Each file is imported
// with DocumentService::importFile and the key 'import:<sha256 of the content>', so running the
// tool again does not duplicate a document. The default data directory is $TINYCAD_DATA_DIR, else
// /data/documents (the Compose volume). Prints one line per file and exits with 1 when at least one
// file failed:
//
//   docker compose run --rm --entrypoint tinycad-import -v ~/tinycad-export:/import core /import
//
// (--entrypoint: the image starts tinycad-core by default; the data volume comes with M45.)

#include <openssl/sha.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/storage/document_service.hpp"
#include "tinycad/storage/store.hpp"

namespace {

namespace fs = std::filesystem;
using namespace tinycad;

constexpr std::string_view FILE_SUFFIX = ".tinycad.json";

std::string sha256Hex(const std::string& content) {
  std::array<unsigned char, SHA256_DIGEST_LENGTH> digest{};
  // OpenSSL takes bytes; std::string holds them as char.
  SHA256(reinterpret_cast<const unsigned char*>(content.data()), content.size(), digest.data());
  std::string hex;
  for (const unsigned char byte : digest) {
    std::array<char, 3> pair{};
    std::snprintf(pair.data(), pair.size(), "%02x", byte);
    hex += pair.data();
  }
  return hex;
}

/** A random UUID v4, the id of a new document. */
std::string uuidV4() {
  static std::mt19937_64 random{std::random_device{}()};
  std::uniform_int_distribution<int> nibble(0, 15);
  std::string uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  for (char& c : uuid) {
    if (c != 'x' && c != 'y') continue;
    int value = nibble(random);
    if (c == 'y') value = (value & 0x3) | 0x8;
    c = "0123456789abcdef"[value];
  }
  return uuid;
}

double nowMs() {
  using namespace std::chrono;
  return static_cast<double>(
      duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

/** The files to import: each argument file as is, each directory's '*.tinycad.json' sorted. */
std::vector<fs::path> collectFiles(const std::vector<std::string>& arguments) {
  std::vector<fs::path> files;
  for (const std::string& argument : arguments) {
    const fs::path path(argument);
    std::error_code error;
    if (!fs::is_directory(path, error)) {
      files.push_back(path);
      continue;
    }
    std::vector<fs::path> inDirectory;
    for (const auto& entry : fs::directory_iterator(path, error)) {
      if (entry.is_regular_file() && entry.path().filename().string().ends_with(FILE_SUFFIX)) {
        inDirectory.push_back(entry.path());
      }
    }
    std::ranges::sort(inDirectory);
    files.insert(files.end(), inDirectory.begin(), inDirectory.end());
  }
  return files;
}

bool readFile(const fs::path& path, std::string& content) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::ostringstream buffer;
  buffer << in.rdbuf();
  content = buffer.str();
  return static_cast<bool>(in) || in.eof();
}

/** The issue paths of a failed import, or its message when it has none. */
std::string describe(const storage::ServiceError& error) {
  if (error.issues.empty()) return error.message;
  std::string text;
  for (const auto& issue : error.issues) {
    if (!text.empty()) text += ", ";
    text += issue.path.empty() ? "(root)" : issue.path;
  }
  return text;
}

int usage() {
  std::cerr << "usage: tinycad-import [--data-dir DIR] <file.tinycad.json | directory>...\n";
  return 2;
}

}  // namespace

int main(int argc, char** argv) {
  const char* fromEnvironment = std::getenv("TINYCAD_DATA_DIR");
  std::string dataDir = fromEnvironment != nullptr ? fromEnvironment : "/data/documents";
  std::vector<std::string> arguments;
  for (int i = 1; i < argc; ++i) {
    const std::string argument = argv[i];
    if (argument == "--data-dir") {
      if (i + 1 >= argc) return usage();
      dataDir = argv[++i];
    } else {
      arguments.push_back(argument);
    }
  }
  if (arguments.empty()) return usage();

  document::FeatureSchemaRegistry schemas;
  features::registerBuiltInSchemas(schemas);
  const ops::OpHandlerRegistry handlers(schemas);
  auto catalog = storage::openSqliteCatalog(dataDir, nowMs);
  storage::DocumentService service({*catalog, schemas, handlers, nowMs, uuidV4});

  bool failed = false;
  for (const fs::path& file : collectFiles(arguments)) {
    std::string content;
    if (!readFile(file, content)) {
      std::cout << "chyba " << file.string() << ": cannot read the file\n";
      failed = true;
      continue;
    }
    const std::string digest = sha256Hex(content);
    auto imported = service.importFile(content, {"import:" + digest, digest});
    if (!imported) {
      std::cout << "chyba " << file.string() << ": " << describe(imported.error()) << '\n';
      failed = true;
      continue;
    }
    std::cout << "ok " << file.string() << " → " << imported->id.str() << ' ' << imported->name
              << '\n';
  }
  return failed ? 1 : 0;
}
