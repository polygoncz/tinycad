# tinycad_core_tests: the helpers of tinycad_core that no other area tests through its own API
# (trimJs, isTrimmed).
include(GoogleTest)

add_executable(tinycad_core_tests
  text_test.cpp)
target_link_libraries(tinycad_core_tests PRIVATE
  tinycad_core GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_core_tests)

gtest_discover_tests(tinycad_core_tests DISCOVERY_MODE PRE_TEST)
