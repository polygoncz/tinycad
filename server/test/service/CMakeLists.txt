# tinycad_service_tests: GeometryService over the gRPC stubs (spec 14).
include(GoogleTest)

add_executable(tinycad_service_tests
  geometry_service_test.cpp)
target_link_libraries(tinycad_service_tests PRIVATE
  tinycad_service GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_service_tests)

gtest_discover_tests(tinycad_service_tests DISCOVERY_MODE PRE_TEST)
