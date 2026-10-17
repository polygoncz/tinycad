# tinycad_ops: operations, their handlers, applyOperation, upcast, the log, replay, the
# dispatcher, transactions and undo (spec 04, M40); the C++ mirror of src/ops. Public headers
# include/tinycad/ops/; handlers/ holds one subclass of OpHandler per operation type (internal).
# Depends on the document only: no OCCT, gRPC or protobuf (the proto conversion is M45, N27).
add_library(tinycad_ops STATIC
  operation.cpp
  handler.cpp
  apply.cpp
  upcast.cpp
  parse_entry.cpp
  replay.cpp
  log.cpp
  dispatcher.cpp
  transaction.cpp
  undo.cpp
  handlers/shape.cpp
  handlers/feature.cpp
  handlers/studio.cpp
  handlers/body.cpp
  handlers/document.cpp)
target_include_directories(tinycad_ops
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_ops PUBLIC cxx_std_23)
target_link_libraries(tinycad_ops PUBLIC tinycad_document)
tinycad_warnings(tinycad_ops)
