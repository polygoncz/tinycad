# tinycad_kernel_tests: the GoogleTest port of the 3D kernel contract suite (src/kernel/testing.ts)
# and of the OCCT adapter tests (test/unit/kernel-occt), M42. A few tests reach internal helpers
# (HistoryCollector, raw OCCT shapes), so the private sources and OCCT are visible here.
include(GoogleTest)

add_executable(tinycad_kernel_tests
  mesh_test.cpp
  profile_test.cpp
  lifecycle_test.cpp
  history_test.cpp
  modeling_test.cpp
  topology_test.cpp
  tessellate_test.cpp
  face_test.cpp
  sweep_test.cpp
  regions_test.cpp
  dressup_test.cpp
  step_test.cpp
  memory_test.cpp
  guarded_test.cpp)
target_include_directories(tinycad_kernel_tests PRIVATE "${PROJECT_SOURCE_DIR}/src/kernel")
target_link_libraries(tinycad_kernel_tests PRIVATE
  tinycad_kernel tinycad_core GTest::gtest GTest::gtest_main
  TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKTopAlgo TKPrim TKBO TKMesh TKDESTEP TKXSBase
  TKDE)
tinycad_warnings(tinycad_kernel_tests)

gtest_discover_tests(tinycad_kernel_tests DISCOVERY_MODE PRE_TEST)
