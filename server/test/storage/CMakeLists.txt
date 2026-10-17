# tinycad_storage_tests: the unit tests of tinycad_storage (port of test/unit/persistence without
# PersistenceService and IndexedDB). They run over real SQLite files in a temporary directory
# (testing.hpp) and see the internal headers of src/storage/src. crash_writer is the helper process
# of the crash test (crash_test.cpp): it writes changes and kills itself with SIGKILL.
include(GoogleTest)

add_executable(crash_writer crash_writer.cpp)
target_include_directories(crash_writer PRIVATE
  "${PROJECT_SOURCE_DIR}/test" "${PROJECT_SOURCE_DIR}/src/storage/src")
target_link_libraries(crash_writer PRIVATE tinycad_storage tinycad_features)
tinycad_warnings(crash_writer)
target_compile_options(crash_writer PRIVATE -Wno-missing-field-initializers)

add_executable(tinycad_storage_tests
  catalog_test.cpp
  document_file_test.cpp
  snapshot_keep_test.cpp
  renamed_to_test.cpp
  snapshot_test.cpp
  load_test.cpp
  tinycad_file_test.cpp
  persistent_document_test.cpp
  idempotence_test.cpp
  document_service_test.cpp
  crash_test.cpp
  tinycad_import_test.cpp)
target_include_directories(tinycad_storage_tests PRIVATE
  "${PROJECT_SOURCE_DIR}/test" "${PROJECT_SOURCE_DIR}/src/storage/src")
target_link_libraries(tinycad_storage_tests PRIVATE
  tinycad_storage tinycad_features unofficial::sqlite3::sqlite3 GTest::gtest GTest::gtest_main)
target_compile_definitions(tinycad_storage_tests PRIVATE
  TINYCAD_CRASH_WRITER="$<TARGET_FILE:crash_writer>"
  TINYCAD_IMPORT_TOOL="$<TARGET_FILE:tinycad-import>"
  TINYCAD_STORAGE_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
add_dependencies(tinycad_storage_tests crash_writer tinycad-import)
tinycad_warnings(tinycad_storage_tests)
# Designated initializers name only the fields a test is about.
target_compile_options(tinycad_storage_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_storage_tests TEST_PREFIX "storage." DISCOVERY_MODE PRE_TEST)
