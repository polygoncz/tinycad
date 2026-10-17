# tinycad_sketch: the sketch model (Sketch, entities, constraints), its data check and JSON, the
# derived curves (pattern copies, letter curves, region curves) and the solver port
# ConstraintSolver (spec 12, M44). Depends only on tinycad_core: no OCCT, no document, no regen.
add_library(tinycad_sketch STATIC
  src/model.cpp
  src/parse.cpp
  src/json.cpp
  src/sketch.cpp
  src/patterns.cpp
  src/text.cpp
  src/geometry.cpp)
target_include_directories(tinycad_sketch
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_sketch PUBLIC cxx_std_23)
target_link_libraries(tinycad_sketch PUBLIC tinycad_core)
tinycad_warnings(tinycad_sketch)
