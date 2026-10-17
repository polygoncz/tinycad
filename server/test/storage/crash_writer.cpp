// The helper process of the crash test (crash_test.cpp): `crash_writer <dir> <K>` creates the
// document of crash_script.hpp in a catalog over <dir>, runs K steps (one durable change each),
// prints the seq of every written entry and kills itself with SIGKILL – no destructors, no
// closing of SQLite, exactly like a crashed server.

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "crash_script.hpp"

int main(int argc, char** argv) {
  using namespace tinycad;
  if (argc != 3) {
    std::fprintf(stderr, "usage: crash_writer <dir> <K>\n");
    return 2;
  }
  const std::int64_t count = std::stoll(argv[2]);
  auto catalog = storage::openSqliteCatalog(argv[1], testing::crash::fixedClock);
  auto doc = testing::crash::createDocument(*catalog, false);
  if (doc == nullptr) {
    std::fprintf(stderr, "crash_writer: cannot create the document\n");
    return 3;
  }
  for (std::int64_t step = 1; step <= count; ++step) {
    if (!testing::crash::runStep(*doc, step) || doc->log().lastSeq() != step) {
      std::fprintf(stderr, "crash_writer: step %lld failed\n", static_cast<long long>(step));
      return 4;
    }
    std::printf("%lld\n", static_cast<long long>(doc->log().lastSeq()));
    std::fflush(stdout);
  }
  std::raise(SIGKILL);
  return 5;  // never reached
}
