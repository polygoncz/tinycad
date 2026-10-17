# tinycad_ops_tests: the unit tests of tinycad_ops (port of test/unit/ops). testing.hpp holds the
# operation builders and a configurable test handler; the document builders come from
# test/document/testing.hpp.
include(GoogleTest)

add_executable(tinycad_ops_tests
  handler_test.cpp
  apply_test.cpp
  upcast_test.cpp
  log_test.cpp
  dispatcher_test.cpp
  transaction_test.cpp
  undo_test.cpp
  replay_property_test.cpp)
target_include_directories(tinycad_ops_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_ops_tests PRIVATE
  tinycad_ops GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_ops_tests)
# Designated initializers name only the fields a test is about.
target_compile_options(tinycad_ops_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_ops_tests DISCOVERY_MODE PRE_TEST)
