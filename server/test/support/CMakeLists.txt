# tinycad_test_support: loading the shared test cases of test/shared-cases (spec 13) and the
# comparison with their expected output; reused by every runner of shared cases.
add_library(tinycad_test_support STATIC
  compare.cpp
  shared_cases.cpp)
target_include_directories(tinycad_test_support PUBLIC "${PROJECT_SOURCE_DIR}/test")
target_compile_features(tinycad_test_support PUBLIC cxx_std_23)
target_compile_definitions(tinycad_test_support PRIVATE
  TINYCAD_SHARED_CASES_DIR="${TINYCAD_SHARED_CASES_DIR}")
target_link_libraries(tinycad_test_support PUBLIC nlohmann_json::nlohmann_json)
tinycad_warnings(tinycad_test_support)
