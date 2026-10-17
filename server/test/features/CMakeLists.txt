# tinycad_features_tests: the unit tests of the built-in feature schemas (port of the schema part
# of test/unit/features/<name>/<name>.test.ts).
include(GoogleTest)

add_executable(tinycad_features_tests
  schemas_test.cpp)
target_link_libraries(tinycad_features_tests PRIVATE
  tinycad_features GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_features_tests)

gtest_discover_tests(tinycad_features_tests DISCOVERY_MODE PRE_TEST)
