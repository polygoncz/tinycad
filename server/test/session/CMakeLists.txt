# tinycad_session_tests: the unit tests of the session layer (domain only, decision N154; the gRPC
# services and their integration tests are in test/rpc).
include(GoogleTest)

add_executable(tinycad_session_tests
  session_error_test.cpp
  recent_responses_test.cpp
  event_ring_test.cpp
  mesh_cache_test.cpp
  read_model_builder_test.cpp
  runtime_document_test.cpp
  runtime_document_transactions_test.cpp
  session_manager_test.cpp
  idle_timeout_test.cpp)
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
