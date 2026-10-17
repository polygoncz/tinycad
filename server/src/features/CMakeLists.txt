# tinycad_features: the schemas (data half) of the built-in features, one folder per feature like
# src/features/<name>/schema.ts (decision N22, M40). Public header
# include/tinycad/features/builtin.hpp (and sketch_solve.hpp, whose SketchOperationSolver is built
# into tinycad_feature_builders); schema_base.hpp and <name>/schema.hpp are internal. The builders
# (geometry half) are a second library tinycad_feature_builders in the same folders (M43, decision
# N44), so this one depends on the document and the sketch model only: no OCCT, gRPC or protobuf.
add_library(tinycad_features STATIC
  builtin.cpp
  box/schema.cpp
  cylinder/schema.cpp
  boolean/schema.cpp
  extrude/schema.cpp
  revolve/schema.cpp
  fillet/schema.cpp
  chamfer/schema.cpp
  transform/schema.cpp
  sketch/schema.cpp)
target_include_directories(tinycad_features
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_features PUBLIC cxx_std_23)
target_link_libraries(tinycad_features PUBLIC tinycad_document tinycad_sketch)
tinycad_warnings(tinycad_features)

# tinycad_feature_builders: the builders (geometry half) of the built-in features, one class per
# feature in <name>/builder.{hpp,cpp} (M43, decision N44); common/ holds their shared internals
# (matrices, param reading, the fillet/chamfer twin). Public header
# include-builders/tinycad/features/builders.hpp, a folder of its own (decision N109), so users of
# the schemas never see regen or the kernel. Only the kernel port, no OCCT type. The sketch
# re-solve before the dispatcher, SketchOperationSolver (sketch_solve.hpp, decision N47), lives
# here too and gets the solver as the port sketch::ConstraintSolver: no tinycad_solver_planegcs.
add_library(tinycad_feature_builders STATIC
  builders.cpp
  common/mat4.cpp
  common/params.cpp
  common/dressup.cpp
  box/builder.cpp
  cylinder/builder.cpp
  boolean/builder.cpp
  extrude/builder.cpp
  revolve/builder.cpp
  fillet/builder.cpp
  chamfer/builder.cpp
  transform/builder.cpp
  sketch/builder.cpp
  sketch/operation_solver.cpp)
target_include_directories(tinycad_feature_builders
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include-builders"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_features(tinycad_feature_builders PUBLIC cxx_std_23)
target_link_libraries(tinycad_feature_builders PUBLIC tinycad_features tinycad_regen tinycad_sketch)
tinycad_warnings(tinycad_feature_builders)
