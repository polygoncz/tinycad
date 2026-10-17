# tinycad_document: the document model, references, the in-memory document, plain JSON, loading
# and migration, feature schemas and their validation (spec 03, M40); the C++ mirror of
# src/document. Public headers include/tinycad/document/ (the contract of the main session);
# ref_kinds.hpp here is internal. No OCCT, gRPC or protobuf.
add_library(tinycad_document STATIC
  model.cpp
  refs.cpp
  document.cpp
  json.cpp
  serialize.cpp
  schema.cpp
  validate.cpp
  ref_kinds.cpp
  rules.cpp
  evaluate.cpp)
target_include_directories(tinycad_document
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_document PUBLIC cxx_std_23)
target_link_libraries(tinycad_document PUBLIC tinycad_core)
tinycad_warnings(tinycad_document)
