# tinycad_session_tests: the unit tests of the session layer and (M45 tasks 4 and 5) the
# integration tests through a real in-process gRPC channel, grpc_*_test.cpp (decision N25).
include(GoogleTest)

# The golden files shared with the TypeScript tests (N75, N88): test/golden of the repository.
set(TINYCAD_GOLDEN_DIR "${PROJECT_SOURCE_DIR}/../test/golden"
    CACHE PATH "Folder with the golden files shared with TS (test/golden)")

add_executable(tinycad_session_tests
  session_error_test.cpp
  operation_codec_test.cpp
  feature_types_test.cpp
  fingerprint_test.cpp
  recent_responses_test.cpp)
target_compile_definitions(tinycad_session_tests PRIVATE
  TINYCAD_GOLDEN_DIR="${TINYCAD_GOLDEN_DIR}")
target_link_libraries(tinycad_session_tests PRIVATE
  tinycad_session tinycad_test_support GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_session_tests)

gtest_discover_tests(tinycad_session_tests DISCOVERY_MODE PRE_TEST)
