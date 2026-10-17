# tinycad_features_tests: the unit tests of the built-in feature schemas (port of the schema part
# of test/unit/features/<name>/<name>.test.ts).
include(GoogleTest)

add_executable(tinycad_features_tests
  schemas_test.cpp
  sketch_schema_test.cpp)
target_link_libraries(tinycad_features_tests PRIVATE
  tinycad_features GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_features_tests)

gtest_discover_tests(tinycad_features_tests DISCOVERY_MODE PRE_TEST)

# tinycad_feature_builders_tests: the builder parts of test/unit/features/<name>/<name>.test.ts
# (M43, M44.1) over the real OcctKernel with the counting decorator of test/regen (decision N45),
# and SketchOperationSolver over the native PlanegcsSolver (M44.1).
add_executable(tinycad_feature_builders_tests
  builders_test.cpp
  box_builder_test.cpp
  cylinder_builder_test.cpp
  boolean_builder_test.cpp
  transform_builder_test.cpp
  fillet_builder_test.cpp
  chamfer_builder_test.cpp
  extrude_builder_test.cpp
  revolve_builder_test.cpp
  sketch_builder_test.cpp
  sketch_operation_solver_test.cpp)
target_include_directories(tinycad_feature_builders_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
# PlanegcsSolver only here: the library gets the solver as the port sketch::ConstraintSolver.
target_link_libraries(tinycad_feature_builders_tests PRIVATE
  tinycad_feature_builders tinycad_regen_testing tinycad_solver_planegcs GTest::gtest
  GTest::gtest_main)
tinycad_warnings(tinycad_feature_builders_tests)
# document/testing.hpp (aFeature) names only the fields a test is about.
target_compile_options(tinycad_feature_builders_tests PRIVATE -Wno-missing-field-initializers)

gtest_discover_tests(tinycad_feature_builders_tests DISCOVERY_MODE PRE_TEST)
