# tinycad_solver_planegcs: the planegcs adapter PlanegcsSolver of the solver port
# sketch::ConstraintSolver (spec 12 "Řešič vazeb", decision N24). Depends on tinycad_sketch and
# the vendored planegcs (Eigen, Boost); no OCCT, no document, no regen.
add_library(tinycad_solver_planegcs STATIC
  src/bspline.cpp
  src/primitives.cpp
  src/gcs_wrapper.cpp
  src/read_back.cpp
  src/planegcs_solver.cpp)
target_include_directories(tinycad_solver_planegcs
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(tinycad_solver_planegcs PUBLIC cxx_std_23)
target_link_libraries(tinycad_solver_planegcs
  PUBLIC tinycad_sketch
  PRIVATE planegcs)
# No fused multiply-add, like the WASM build of the TS adapter (see third_party/planegcs).
target_compile_options(tinycad_solver_planegcs PRIVATE -ffp-contract=off)
tinycad_warnings(tinycad_solver_planegcs)
