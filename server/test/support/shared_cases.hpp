#pragma once

// Loading the shared test cases of an area from test/shared-cases/<area>/ (spec 13, "Soubory a
// běh"). The folder comes from the environment variable TINYCAD_SHARED_CASES_DIR, else from the
// CMake cache variable of the same name compiled in.

#include <nlohmann/json.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace tinycad::testing {

std::filesystem::path sharedCasesRoot();

/** The names (file names without .json) of the cases of an area, sorted. */
std::vector<std::string> caseNames(const std::string& area);

/** The parsed case; throws with the path when the file cannot be read. */
nlohmann::json loadCase(const std::string& area, const std::string& name);

}  // namespace tinycad::testing
