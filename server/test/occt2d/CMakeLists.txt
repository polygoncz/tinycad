# tinycad_occt2d_tests: the 2D base of tinycad_kernel and tinycad_geometry (decision N77).
include(GoogleTest)

add_executable(tinycad_occt2d_tests
  occt2d_test.cpp)
target_link_libraries(tinycad_occt2d_tests PRIVATE
  tinycad_occt2d GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_occt2d_tests)

gtest_discover_tests(tinycad_occt2d_tests DISCOVERY_MODE PRE_TEST)
