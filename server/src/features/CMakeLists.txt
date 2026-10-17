# tinycad_features: the schemas (data half) of the built-in features, one folder per feature like
# src/features/<name>/schema.ts (decision N22, M40). Public header
# include/tinycad/features/builtin.hpp; schema_base.hpp and <name>/schema.hpp are internal. The
# builders (geometry half) are a second library tinycad_feature_builders in the same folders
# (M43, decision N44), so this one depends on the document only: no OCCT, gRPC or protobuf.
add_library(tinycad_features STATIC
  builtin.cpp
  box/schema.cpp
  cylinder/schema.cpp
  boolean/schema.cpp
  extrude/schema.cpp
  revolve/schema.cpp
  fillet/schema.cpp
  chamfer/schema.cpp
  transform/schema.cpp)
target_include_directories(tinycad_features
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_features PUBLIC cxx_std_23)
target_link_libraries(tinycad_features PUBLIC tinycad_document)
tinycad_warnings(tinycad_features)
