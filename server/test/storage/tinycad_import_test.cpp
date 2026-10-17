// The tinycad-import tool (decision N38): a directory with two valid files and one broken file,
// run as a real process twice – the second run does not duplicate the documents.

#include <gtest/gtest.h>

#include <fstream>

#include "storage/testing.hpp"

namespace tinycad::storage {
namespace {

void copyFixture(const std::string& name, const std::filesystem::path& to) {
  std::filesystem::copy_file(std::filesystem::path(TINYCAD_STORAGE_FIXTURES) / name, to / name);
}

TEST(TinycadImport, ImportsEveryFileOfADirectoryAndReportsTheBrokenOne) {
  testing::TempDir dir;
  const auto input = dir.path() / "import";
  const auto data = dir.path() / "data";
  std::filesystem::create_directories(input);
  copyFixture("old-part-v1.tinycad.json", input);
  copyFixture("bracket-history.tinycad.json", input);
  std::ofstream(input / "broken.tinycad.json") << R"({"format":"x","formatVersion":1})";
  std::ofstream(input / "notes.txt") << "not a document";

  const auto first = testing::runProcess(TINYCAD_IMPORT_TOOL, {"--data-dir", data.string(), input.string()},
                                         dir.path() / "first.txt");
  ASSERT_TRUE(WIFEXITED(first.status));
  EXPECT_EQ(WEXITSTATUS(first.status), 1) << first.out;
  EXPECT_NE(first.out.find("ok " + (input / "bracket-history.tinycad.json").string() + " → "),
            std::string::npos)
      << first.out;
  EXPECT_NE(first.out.find(" Bracket\n"), std::string::npos) << first.out;
  EXPECT_NE(first.out.find(" Old part\n"), std::string::npos) << first.out;
  EXPECT_NE(first.out.find("chyba " + (input / "broken.tinycad.json").string() + ": format\n"),
            std::string::npos)
      << first.out;
  EXPECT_EQ(first.out.find("notes.txt"), std::string::npos);

  testing::ManualClock clock;
  auto catalog = openSqliteCatalog(data, clock.clock());
  const auto afterFirst = catalog->list().value();
  ASSERT_EQ(afterFirst.size(), 2U);

  // Running it again finds the documents by their content key: nothing is duplicated.
  const auto second = testing::runProcess(TINYCAD_IMPORT_TOOL, {"--data-dir", data.string(), input.string()},
                                          dir.path() / "second.txt");
  EXPECT_EQ(WEXITSTATUS(second.status), 1);
  const auto afterSecond = catalog->list().value();
  ASSERT_EQ(afterSecond.size(), 2U);
  for (const auto& info : afterFirst) {
    EXPECT_NE(second.out.find(info.meta.id.str() + " " + info.meta.name), std::string::npos) << second.out;
  }
}

TEST(TinycadImport, SingleValidFilesExitWith0) {
  testing::TempDir dir;
  copyFixture("old-part-v1.tinycad.json", dir.path());
  const auto result = testing::runProcess(
      TINYCAD_IMPORT_TOOL,
      {"--data-dir", (dir.path() / "data").string(), (dir.path() / "old-part-v1.tinycad.json").string()},
      dir.path() / "out.txt");
  ASSERT_TRUE(WIFEXITED(result.status));
  EXPECT_EQ(WEXITSTATUS(result.status), 0) << result.out;
}

TEST(TinycadImport, WithoutFilesPrintsUsage) {
  testing::TempDir dir;
  const auto result = testing::runProcess(TINYCAD_IMPORT_TOOL, {}, dir.path() / "out.txt");
  EXPECT_EQ(WEXITSTATUS(result.status), 2);
}

}  // namespace
}  // namespace tinycad::storage
