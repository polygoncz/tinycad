# tinycad_shared_cases_tests: the runners of the shared cases (spec 13), one file per area
# (<area>_cases_test.cpp); M39 has geometry.*.
include(GoogleTest)

add_executable(tinycad_shared_cases_tests
  geometry_cases_test.cpp)
target_link_libraries(tinycad_shared_cases_tests PRIVATE
  tinycad_test_support tinycad_geometry tinycad_core GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_shared_cases_tests)

gtest_discover_tests(tinycad_shared_cases_tests DISCOVERY_MODE PRE_TEST)
