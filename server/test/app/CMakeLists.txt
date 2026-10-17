# tinycad_app_tests: a smoke test of the composed server (CoreServer) over TCP on localhost.
include(GoogleTest)

add_executable(tinycad_app_tests
  core_server_test.cpp)
target_link_libraries(tinycad_app_tests PRIVATE
  tinycad_app GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_app_tests)

gtest_discover_tests(tinycad_app_tests DISCOVERY_MODE PRE_TEST)
