# tinycad_storage: documents as SQLite files with their operation log and snapshots, loading,
# the .tinycad.json file, the persistent document and the document catalog service (spec 05,
# spec 14, M41, decisions N32–N39); the C++ counterpart of src/persistence. Public headers
# include/tinycad/storage/ (the contract for M45); src/ holds the internal parts. Depends on the
# document, the operations and SQLite only: no OCCT, regeneration, gRPC or protobuf.
add_library(tinycad_storage STATIC
  src/error.cpp
  src/sqlite.cpp
  src/schema.cpp
  src/snapshot_keep.cpp
  src/renamed_to.cpp
  src/sqlite_document_file.cpp
  src/sqlite_catalog.cpp
  src/snapshot.cpp
  src/load.cpp
  src/tinycad_file.cpp
  src/persistent_document.cpp
  src/document_service.cpp)
target_include_directories(tinycad_storage
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_storage PUBLIC cxx_std_23)
target_link_libraries(tinycad_storage
  PUBLIC tinycad_document tinycad_ops
  PRIVATE unofficial::sqlite3::sqlite3)
tinycad_warnings(tinycad_storage)
