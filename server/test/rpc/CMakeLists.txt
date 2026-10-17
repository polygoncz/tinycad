# tinycad_rpc_tests: the gRPC layer (decision N154): the conversions (operations, feature types,
# read model, fingerprint), the error statuses, GeometryService, and the integration tests of
# SessionService and DocumentService through a real in-process gRPC channel, grpc_*_test.cpp
# (decision N25).
include(GoogleTest)

# The golden files shared with the TypeScript tests (N75, N88): test/golden of the repository.
set(TINYCAD_GOLDEN_DIR "${PROJECT_SOURCE_DIR}/../test/golden"
    CACHE PATH "Folder with the golden files shared with TS (test/golden)")

add_executable(tinycad_rpc_tests
  status_test.cpp
  operation_codec_test.cpp
  feature_types_test.cpp
  fingerprint_test.cpp
  read_model_proto_test.cpp
  geometry_service_test.cpp
  grpc_documents_test.cpp
  grpc_session_test.cpp
  grpc_idempotence_test.cpp
  grpc_transactions_test.cpp
  grpc_meshes_test.cpp
  grpc_watch_test.cpp)
target_compile_definitions(tinycad_rpc_tests PRIVATE
  TINYCAD_GOLDEN_DIR="${TINYCAD_GOLDEN_DIR}"
  # grpc_documents_test.cpp imports the .tinycad.json files of the storage tests (M41).
  TINYCAD_STORAGE_FIXTURES="${PROJECT_SOURCE_DIR}/test/storage/fixtures")
# The harnesses reuse the session fixtures (session/runtime_testing.hpp, session/testing.hpp),
# which build the real kernel and solver (N45) and the failing store of M41.
target_include_directories(tinycad_rpc_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_rpc_tests PRIVATE
  tinycad_rpc tinycad_kernel tinycad_solver_planegcs tinycad_test_support GTest::gtest
  GTest::gtest_main tinycad_feature_builders tinycad_regen_testing)
tinycad_warnings(tinycad_rpc_tests)
# Designated and aggregate initializers name only the fields a test is about.
target_compile_options(tinycad_rpc_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_rpc_tests DISCOVERY_MODE PRE_TEST)
