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
  recent_responses_test.cpp
  event_ring_test.cpp
  mesh_cache_test.cpp
  read_model_builder_test.cpp
  runtime_document_test.cpp
  runtime_document_transactions_test.cpp
  session_manager_test.cpp
  idle_timeout_test.cpp
  grpc_session_test.cpp
  grpc_idempotence_test.cpp
  grpc_transactions_test.cpp
  grpc_meshes_test.cpp
  grpc_watch_test.cpp)
target_compile_definitions(tinycad_session_tests PRIVATE
  TINYCAD_GOLDEN_DIR="${TINYCAD_GOLDEN_DIR}")
# runtime_testing.hpp includes test/storage/failing_file.hpp (the failing store of M41) and builds
# the real kernel and solver (N45); the session library itself gets only their factories (N109).
target_include_directories(tinycad_session_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_session_tests PRIVATE
  tinycad_session tinycad_kernel tinycad_solver_planegcs tinycad_test_support GTest::gtest
  GTest::gtest_main
  # testing.hpp: the built-in builders and the counting kernel of regen (M45 task 2).
  tinycad_feature_builders tinycad_regen_testing)
tinycad_warnings(tinycad_session_tests)
# Designated and aggregate initializers name only the fields a test is about.
target_compile_options(tinycad_session_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_session_tests DISCOVERY_MODE PRE_TEST)
