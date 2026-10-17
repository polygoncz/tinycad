#include "support/shared_cases.hpp"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <stdexcept>

namespace tinycad::testing {

std::filesystem::path sharedCasesRoot() {
  const char* fromEnv = std::getenv("TINYCAD_SHARED_CASES_DIR");
  if (fromEnv != nullptr && *fromEnv != '\0') return fromEnv;
  return TINYCAD_SHARED_CASES_DIR;
}

std::vector<std::string> caseNames(const std::string& area) {
  std::vector<std::string> names;
  const auto dir = sharedCasesRoot() / area;
  if (!std::filesystem::is_directory(dir)) return names;
  for (const auto& entry : std::filesystem::directory_iterator(dir)) {
    if (entry.path().extension() == ".json") names.push_back(entry.path().stem().string());
  }
  std::sort(names.begin(), names.end());
  return names;
}

nlohmann::json loadCase(const std::string& area, const std::string& name) {
  const auto file = sharedCasesRoot() / area / (name + ".json");
  std::ifstream in(file);
  if (!in) throw std::runtime_error("cannot read " + file.string());
  try {
    return nlohmann::json::parse(in);
  } catch (const nlohmann::json::exception& e) {
    throw std::runtime_error(file.string() + ": " + e.what());
  }
}

}  // namespace tinycad::testing
