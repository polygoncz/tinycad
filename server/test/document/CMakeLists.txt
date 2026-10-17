# tinycad_document_tests: the unit tests of tinycad_document (port of test/unit/document).
# testing.hpp holds the test builders aFeature() and aDocument() for these and the ops tests.
include(GoogleTest)

add_executable(tinycad_document_tests
  cad_document_test.cpp
  json_test.cpp
  model_test.cpp
  refs_test.cpp
  schema_test.cpp
  serialize_test.cpp
  validate_test.cpp)
target_include_directories(tinycad_document_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_document_tests PRIVATE
  tinycad_document GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_document_tests)
# Designated initializers name only the fields a test is about.
target_compile_options(tinycad_document_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_document_tests DISCOVERY_MODE PRE_TEST)
