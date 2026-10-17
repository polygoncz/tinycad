# tinycad_sketch_tests: the sketch model, its data check and JSON, the derived curves (port of
# test/unit/sketch/{model,parse,points,patterns,text,geometry}.test.ts).
include(GoogleTest)

add_executable(tinycad_sketch_tests
  model_test.cpp
  parse_test.cpp
  json_test.cpp
  patterns_test.cpp
  text_test.cpp
  geometry_test.cpp)
target_link_libraries(tinycad_sketch_tests PRIVATE
  tinycad_sketch tinycad_test_support GTest::gtest GTest::gtest_main)
tinycad_warnings(tinycad_sketch_tests)

gtest_discover_tests(tinycad_sketch_tests DISCOVERY_MODE PRE_TEST)
