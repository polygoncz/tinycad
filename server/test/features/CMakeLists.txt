# tinycad_features_tests: the unit tests of the built-in feature schemas (port of the schema part
# of test/unit/features/<name>/<name>.test.ts).
include(GoogleTest)

add_executable(tinycad_features_tests
  schemas_test.cpp)
target_link_libraries(tinycad_features_tests PRIVATE
  tinycad_features GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_features_tests)

gtest_discover_tests(tinycad_features_tests DISCOVERY_MODE PRE_TEST)

# tinycad_feature_builders_tests: the builder parts of test/unit/features/<name>/<name>.test.ts
# (M43) over the real OcctKernel with the counting decorator of test/regen (decision N45).
add_executable(tinycad_feature_builders_tests
  builders_test.cpp
  box_builder_test.cpp
  cylinder_builder_test.cpp
  boolean_builder_test.cpp
  transform_builder_test.cpp
  fillet_builder_test.cpp
  chamfer_builder_test.cpp
  extrude_builder_test.cpp
  revolve_builder_test.cpp)
target_include_directories(tinycad_feature_builders_tests PRIVATE "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_feature_builders_tests PRIVATE
  tinycad_feature_builders tinycad_regen_testing GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_feature_builders_tests)

gtest_discover_tests(tinycad_feature_builders_tests DISCOVERY_MODE PRE_TEST)
