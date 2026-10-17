# tinycad_solver_planegcs_tests: the smoke test of the vendored planegcs and the tests of the
# adapter PlanegcsSolver (port of test/unit/solver-planegcs/{solve,solve-offset,shapes}.test.ts).
# White-box like the TS tests: the adapter's internal headers (src/) are on the include path for
# the B-spline evaluation the spline tests measure with.
include(GoogleTest)

add_executable(tinycad_solver_planegcs_tests
  planegcs_smoke_test.cpp
  planegcs_solver_test.cpp
  shapes_test.cpp)
target_include_directories(tinycad_solver_planegcs_tests PRIVATE
  "${PROJECT_SOURCE_DIR}/src/solver-planegcs/src")
target_link_libraries(tinycad_solver_planegcs_tests PRIVATE
  tinycad_solver_planegcs planegcs GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_solver_planegcs_tests)

gtest_discover_tests(tinycad_solver_planegcs_tests DISCOVERY_MODE PRE_TEST)
