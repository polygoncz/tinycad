# tinycad_regen_tests: the unit tests of regen (port of test/unit/regen, M43) over the real
# OcctKernel with the counting decorator (decision N45). tinycad_regen_testing holds the shared
# helpers (testing.hpp: CountingKernel, the test feature type, aSketchArtifact, aNameTable …),
# also used by the builder tests of test/features.
include(GoogleTest)

add_library(tinycad_regen_testing STATIC testing.cpp)
target_include_directories(tinycad_regen_testing PUBLIC "${PROJECT_SOURCE_DIR}/test")
target_link_libraries(tinycad_regen_testing PUBLIC tinycad_regen tinycad_kernel GTest::gtest)
tinycad_warnings(tinycad_regen_testing)

add_executable(tinycad_regen_tests
  state_test.cpp
  names_test.cpp
  name_shape_test.cpp
  tracking_kernel_test.cpp
  builder_test.cpp
  build_context_test.cpp
  face_plane_test.cpp
  body_operation_test.cpp
  regenerator_test.cpp
  regenerator_anchors_test.cpp
  regenerator_input_test.cpp
  regenerator_sweep_test.cpp
  content_version_test.cpp
  regenerator_property_test.cpp
  regeneration_measure_test.cpp)
target_link_libraries(tinycad_regen_tests PRIVATE
  tinycad_regen_testing tinycad_regen tinycad_regen_describe tinycad_test_support
  tinycad_feature_builders GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_regen_tests)

# regeneration_measure_test.cpp (N156) loads the document of a shared regen case (tinycad_test_support)
# and regenerates it with the built-in schemas and builders (tinycad_feature_builders).
gtest_discover_tests(tinycad_regen_tests DISCOVERY_MODE PRE_TEST)
